import { isDeepStrictEqual } from 'node:util';
import { answerStep, startSession, selectSessionStory, type AnswerPayload } from '../engine/session';
import type { Profile, Session, SkillState, ProgramState, PlayerState } from '../types';
import { validateStore } from '../store-validation';
import { makeSessionMemory, type ProfileSnapshot } from './session-memory';
import type { SqlClient } from './migrate';

// All writers allocating ordinals must use the corresponding transaction-scoped lock.
const ORDINAL_LOCK = { skills: 726391811, program_states: 726391812, player_states: 726391813, sessions: 726391814 } as const;
type Table = keyof typeof ORDINAL_LOCK;

export async function transaction<T>(client: SqlClient, run: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try { const result = await run(); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
}
export async function snapshot(client: SqlClient, profile: Profile): Promise<ProfileSnapshot> {
  const read = async (table: Table) => (await client.query(`SELECT data FROM gib.${table} WHERE profile_id=$1 ORDER BY ordinal`, [profile.id])).rows.map(row => row.data);
  const state = {
    profile,
    skills: await read('skills') as (SkillState & { profileId: string })[],
    programStates: await read('program_states') as ProgramState[],
    playerStates: await read('player_states') as PlayerState[],
    sessions: await read('sessions') as Session[],
  };
  validateStore({ profiles: [profile], skills: state.skills, sessions: state.sessions, programStates: state.programStates, playerStates: state.playerStates });
  return state;
}
async function nextOrdinal(client: SqlClient, table: Table): Promise<number> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ORDINAL_LOCK[table]]);
  const result = await client.query(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM gib.${table}`);
  const value = Number(result.rows[0].next);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid ordinal');
  return value;
}
function checkCount(actual: { rows: Record<string, unknown>[] }): void {
  if (actual.rows.length !== 1) throw new Error('Concurrent session write or missing record');
}
export async function persist(client: SqlClient, before: ProfileSnapshot, after: ProfileSnapshot): Promise<void> {
  validateStore({ profiles: [after.profile], skills: after.skills, sessions: after.sessions, programStates: after.programStates, playerStates: after.playerStates });
  if (!isDeepStrictEqual(before.profile, after.profile)) throw new Error('Session operation cannot modify profile');
  // Session operations never delete rows. Silently dropping a row would lose data.
  if (after.skills.length < before.skills.length || after.sessions.length < before.sessions.length || after.programStates.length < before.programStates.length || after.playerStates.length < before.playerStates.length) throw new Error('Unexpected session data removal');
  let skillOrdinal: number | undefined;
  for (const skill of after.skills) {
    const old = before.skills.find(s => s.profileId === skill.profileId && s.skill === skill.skill);
    if (old && isDeepStrictEqual(old, skill)) continue;
    if (old) checkCount(await client.query('UPDATE gib.skills SET data=$1::jsonb WHERE profile_id=$2 AND skill=$3 RETURNING skill', [JSON.stringify(skill), skill.profileId, skill.skill]));
    else {
      if (skillOrdinal === undefined) skillOrdinal = await nextOrdinal(client, 'skills');
      await client.query('INSERT INTO gib.skills(profile_id,ordinal,skill,data) VALUES($1,$2,$3,$4::jsonb)', [skill.profileId, skillOrdinal++, skill.skill, JSON.stringify(skill)]);
    }
  }
  for (const [table, previous, current] of [
    ['program_states', before.programStates, after.programStates],
    ['player_states', before.playerStates, after.playerStates],
  ] as const) {
    for (const value of current) {
      const old = previous.find(p => p.profileId === value.profileId);
      if (old && isDeepStrictEqual(old, value)) continue;
      if (old) checkCount(await client.query(`UPDATE gib.${table} SET data=$1::jsonb WHERE profile_id=$2 RETURNING profile_id`, [JSON.stringify(value), value.profileId]));
      else await client.query(`INSERT INTO gib.${table}(profile_id,ordinal,data) VALUES($1,$2,$3::jsonb)`, [value.profileId, await nextOrdinal(client, table), JSON.stringify(value)]);
    }
  }
  let sessionOrdinal: number | undefined;
  for (const session of after.sessions) {
    const old = before.sessions.find(s => s.id === session.id);
    if (old && isDeepStrictEqual(old, session)) continue;
    if (old) checkCount(await client.query('UPDATE gib.sessions SET started_at=$1,finished_at=$2,data=$3::jsonb WHERE id=$4 AND profile_id=$5 RETURNING id', [session.startedAt, session.finishedAt ?? null, JSON.stringify(session), session.id, session.profileId]));
    else {
      if (sessionOrdinal === undefined) sessionOrdinal = await nextOrdinal(client, 'sessions');
      await client.query('INSERT INTO gib.sessions(id,ordinal,profile_id,started_at,finished_at,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [session.id, sessionOrdinal++, session.profileId, session.startedAt, session.finishedAt ?? null, JSON.stringify(session)]);
    }
  }
}

/** Experimental: requires one dedicated PostgreSQL connection and all writers to lock the profile row. */
export async function startOwnedSession(client: SqlClient, parentId: string, profileId: string, repeat = false, storyChoice = false) {
  if (typeof parentId !== 'string' || !parentId || typeof profileId !== 'string' || !profileId || typeof repeat !== 'boolean' || typeof storyChoice !== 'boolean') return { error: 'invalid_start' } as const;
  return transaction(client, async () => {
    const rows = await client.query('SELECT data FROM gib.profiles WHERE id=$1 AND parent_id=$2 FOR UPDATE', [profileId, parentId]);
    if (!rows.rows.length) return { error: 'profile_not_found' } as const;
    const before = await snapshot(client, rows.rows[0].data as Profile);
    const working = makeSessionMemory(before);
    const result = startSession(working.state.profile, repeat, working.store, { storyChoice });
    await persist(client, before, working.state);
    return result;
  });
}

/** Same owner/profile lock as answer and reward operations; not connected to HTTP. */
export async function selectOwnedStory(client: SqlClient, parentId: string, sessionId: string, cardId: string) {
  if (typeof parentId !== 'string' || !parentId || typeof sessionId !== 'string' || !sessionId || typeof cardId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(cardId)) return { error: 'invalid_story' } as const;
  return transaction(client, async () => {
    const rows = await client.query('SELECT p.data FROM gib.profiles p JOIN gib.sessions s ON s.profile_id=p.id WHERE p.parent_id=$1 AND s.id=$2 FOR UPDATE OF p', [parentId, sessionId]);
    if (!rows.rows.length) return { error: 'session_not_found' } as const;
    const before = await snapshot(client, rows.rows[0].data as Profile);
    const working = makeSessionMemory(before);
    const result = selectSessionStory(sessionId, cardId, working.store);
    if (!('error' in result)) await persist(client, before, working.state);
    return result;
  });
}

/** Last-step receipt and rewards commit in the same transaction; duplicate requests use the domain engine receipt. */
export async function answerOwnedSession(client: SqlClient, parentId: string, sessionId: string, payload: AnswerPayload, ms: number, step: number) {
  if (typeof parentId !== 'string' || !parentId || typeof sessionId !== 'string' || !sessionId || !Number.isInteger(step) || step < 0 || !Number.isFinite(ms) || ms < 0) return { error: 'invalid_request' } as const;
  return transaction(client, async () => {
    const rows = await client.query('SELECT p.data FROM gib.profiles p JOIN gib.sessions s ON s.profile_id=p.id WHERE p.parent_id=$1 AND s.id=$2 FOR UPDATE OF p', [parentId, sessionId]);
    if (!rows.rows.length) return { error: 'session_not_found' } as const;
    const before = await snapshot(client, rows.rows[0].data as Profile);
    const working = makeSessionMemory(before);
    const result = answerStep(sessionId, payload, ms, step, working.store);
    if (!('error' in result)) await persist(client, before, working.state);
    return result;
  });
}
