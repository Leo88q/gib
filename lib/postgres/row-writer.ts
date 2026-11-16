/**
 * Асинхронная построчная запись игровых транзакций в PostgreSQL без общего
 * `pg_advisory_xact_lock` (`WRITE_LOCK` / `ORDINAL_LOCK`).
 *
 * Как устроена конкурентность между репликами:
 *  1. Вместо сериализации всего сервера блокируется строка конкретного профиля
 *     (`SELECT ... FROM gib.profiles WHERE id=$1 AND parent_id=$2 FOR UPDATE`),
 *     поэтому разные семьи пишут параллельно без взаимного ожидания.
 *  2. Каждая изменяемая строка проверяется по `row_version` (оптимистический
 *     контроль версий: `SET ..., row_version = row_version + 1 WHERE ... AND row_version = $expected`).
 *  3. Порядковые номера `ordinal` выделяются атомарно через `SEQUENCE`
 *     (`gib.<table>_ordinal_seq`) без табличных advisory-блокировок.
 *  4. Технический журнал событий (`gib.events`) фиксируется в той же транзакции
 *     через идемпотентный `ON CONFLICT (dedupe_key) DO NOTHING`.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  answerStep,
  publicItem,
  selectSessionStory,
  startSession,
  type AnswerPayload,
} from '../engine/session.ts';
import { publicPlayer } from '../engine/player-view.ts';
import { buyItem, claimMission, ensureMissions } from '../engine/rewards.ts';
import { SHOP } from '../gamification.ts';
import type { EventJournal, EventError, StoredEvent } from '../events/journal.ts';
import { validateEvent } from '../events/journal.ts';
import { validateStore } from '../store-validation.ts';
import type { PlayerState, Profile, ProgramState, Session, SkillState } from '../types.ts';
import type { AsyncQueryable } from './async-pool.ts';
import { ROW_LEVEL_WRITE_SCHEMA } from './schema.ts';
import { makeSessionMemory, type ProfileSnapshot } from './session-memory.ts';

export class ConcurrentRowVersionError extends Error {
  constructor(table: string, key: string) {
    super(`concurrent_row_version_conflict:${table}:${key}`);
    this.name = 'ConcurrentRowVersionError';
  }
}

type VersionedProfileSnapshot = ProfileSnapshot & {
  versions: {
    skills: Map<string, number>;
    programStates: Map<string, number>;
    playerStates: Map<string, number>;
    sessions: Map<string, number>;
  };
};

const initializedClients = new WeakSet<object>();
let globalPoolSchemaReady = false;

export async function ensureRowLevelSchema(
  client: AsyncQueryable,
  options: { useGlobalFlag?: boolean } = {},
): Promise<void> {
  if (options.useGlobalFlag && globalPoolSchemaReady) return;
  if (!options.useGlobalFlag && initializedClients.has(client as object)) return;

  for (const stmt of ROW_LEVEL_WRITE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await client.query(stmt);
  }
  if (options.useGlobalFlag) globalPoolSchemaReady = true;
  else initializedClients.add(client as object);
}

async function inRowTransaction<T>(client: AsyncQueryable, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const res = await fn();
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function allocateOrdinal(
  client: AsyncQueryable,
  table: 'skills' | 'sessions' | 'program_states' | 'player_states' | 'events',
): Promise<number> {
  const seq = `gib.${table}_ordinal_seq`;
  const res = await client.query<{ ord: number | string }>(
    `SELECT setval('${seq}', GREATEST(nextval('${seq}'), COALESCE((SELECT MAX(ordinal) + 1 FROM gib.${table}), 0)), true) AS ord`,
  );
  const ord = Number(res.rows[0]?.ord ?? 0);
  if (!Number.isSafeInteger(ord) || ord < 0) throw new Error(`invalid_sequence_ordinal:${table}`);
  return ord;
}

async function loadVersionedSnapshot(
  client: AsyncQueryable,
  profile: Profile,
): Promise<VersionedProfileSnapshot> {
  const skillsRes = await client.query<{ skill: string; data: SkillState & { profileId: string }; row_version: number | string }>(
    'SELECT skill, data, row_version FROM gib.skills WHERE profile_id = $1 ORDER BY ordinal ASC',
    [profile.id],
  );
  const progRes = await client.query<{ profile_id: string; data: ProgramState; row_version: number | string }>(
    'SELECT profile_id, data, row_version FROM gib.program_states WHERE profile_id = $1 ORDER BY ordinal ASC',
    [profile.id],
  );
  const playerRes = await client.query<{ profile_id: string; data: PlayerState; row_version: number | string }>(
    'SELECT profile_id, data, row_version FROM gib.player_states WHERE profile_id = $1 ORDER BY ordinal ASC',
    [profile.id],
  );
  const sessRes = await client.query<{ id: string; data: Session; row_version: number | string }>(
    'SELECT id, data, row_version FROM gib.sessions WHERE profile_id = $1 ORDER BY ordinal ASC',
    [profile.id],
  );

  const skills = skillsRes.rows.map((r) => r.data);
  const programStates = progRes.rows.map((r) => r.data);
  const playerStates = playerRes.rows.map((r) => r.data);
  const sessions = sessRes.rows.map((r) => r.data);

  validateStore({
    profiles: [profile],
    skills,
    sessions,
    programStates,
    playerStates,
  });

  return {
    profile,
    skills,
    programStates,
    playerStates,
    sessions,
    versions: {
      skills: new Map(skillsRes.rows.map((r) => [r.skill, Number(r.row_version)])),
      programStates: new Map(progRes.rows.map((r) => [r.profile_id, Number(r.row_version)])),
      playerStates: new Map(playerRes.rows.map((r) => [r.profile_id, Number(r.row_version)])),
      sessions: new Map(sessRes.rows.map((r) => [r.id, Number(r.row_version)])),
    },
  };
}

async function persistRowChanges(
  client: AsyncQueryable,
  before: VersionedProfileSnapshot,
  after: ProfileSnapshot,
  stagedEvents: StoredEvent[],
): Promise<void> {
  validateStore({
    profiles: [after.profile],
    skills: after.skills,
    sessions: after.sessions,
    programStates: after.programStates,
    playerStates: after.playerStates,
  });

  if (!isDeepStrictEqual(before.profile, after.profile)) {
    throw new Error('Row session writer cannot mutate profile record');
  }

  for (const skill of after.skills) {
    const old = before.skills.find((s) => s.profileId === skill.profileId && s.skill === skill.skill);
    if (old && isDeepStrictEqual(old, skill)) continue;
    if (old) {
      const expectedVersion = before.versions.skills.get(skill.skill) ?? 1;
      const updated = await client.query(
        `UPDATE gib.skills
            SET data = $1::jsonb, row_version = row_version + 1
          WHERE profile_id = $2 AND skill = $3 AND row_version = $4
          RETURNING row_version`,
        [JSON.stringify(skill), skill.profileId, skill.skill, expectedVersion],
      );
      if (updated.rows.length !== 1) {
        throw new ConcurrentRowVersionError('skills', `${skill.profileId}:${skill.skill}`);
      }
    } else {
      const ordinal = await allocateOrdinal(client, 'skills');
      const upserted = await client.query(
        `INSERT INTO gib.skills (profile_id, ordinal, skill, data, row_version)
         VALUES ($1, $2, $3, $4::jsonb, 1)
         ON CONFLICT (profile_id, skill) DO UPDATE
           SET data = EXCLUDED.data, row_version = gib.skills.row_version + 1
         RETURNING row_version`,
        [skill.profileId, ordinal, skill.skill, JSON.stringify(skill)],
      );
      if (upserted.rows.length !== 1) {
        throw new ConcurrentRowVersionError('skills', `${skill.profileId}:${skill.skill}`);
      }
    }
  }

  for (const [table, prevList, currList, versionMap] of [
    ['program_states', before.programStates, after.programStates, before.versions.programStates],
    ['player_states', before.playerStates, after.playerStates, before.versions.playerStates],
  ] as const) {
    for (const item of currList) {
      const old = prevList.find((p) => p.profileId === item.profileId);
      if (old && isDeepStrictEqual(old, item)) continue;
      if (old) {
        const expectedVersion = versionMap.get(item.profileId) ?? 1;
        const updated = await client.query(
          `UPDATE gib.${table}
              SET data = $1::jsonb, row_version = row_version + 1
            WHERE profile_id = $2 AND row_version = $3
            RETURNING row_version`,
          [JSON.stringify(item), item.profileId, expectedVersion],
        );
        if (updated.rows.length !== 1) {
          throw new ConcurrentRowVersionError(table, item.profileId);
        }
      } else {
        const ordinal = await allocateOrdinal(client, table);
        const upserted = await client.query(
          `INSERT INTO gib.${table} (profile_id, ordinal, data, row_version)
           VALUES ($1, $2, $3::jsonb, 1)
           ON CONFLICT (profile_id) DO UPDATE
             SET data = EXCLUDED.data, row_version = gib.${table}.row_version + 1
           RETURNING row_version`,
          [item.profileId, ordinal, JSON.stringify(item)],
        );
        if (upserted.rows.length !== 1) {
          throw new ConcurrentRowVersionError(table, item.profileId);
        }
      }
    }
  }

  for (const session of after.sessions) {
    const old = before.sessions.find((s) => s.id === session.id);
    if (old && isDeepStrictEqual(old, session)) continue;
    if (old) {
      const expectedVersion = before.versions.sessions.get(session.id) ?? 1;
      const updated = await client.query(
        `UPDATE gib.sessions
            SET started_at = $1,
                finished_at = $2,
                data = $3::jsonb,
                row_version = row_version + 1
          WHERE id = $4 AND profile_id = $5 AND row_version = $6
          RETURNING row_version`,
        [session.startedAt, session.finishedAt ?? null, JSON.stringify(session), session.id, session.profileId, expectedVersion],
      );
      if (updated.rows.length !== 1) {
        throw new ConcurrentRowVersionError('sessions', session.id);
      }
    } else {
      const ordinal = await allocateOrdinal(client, 'sessions');
      await client.query(
        `INSERT INTO gib.sessions (id, ordinal, profile_id, started_at, finished_at, data, row_version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1)`,
        [session.id, ordinal, session.profileId, session.startedAt, session.finishedAt ?? null, JSON.stringify(session)],
      );
    }
  }

  for (const ev of stagedEvents) {
    const ordinal = await allocateOrdinal(client, 'events');
    await client.query(
      `INSERT INTO gib.events (id, ordinal, profile_id, owner_id, at, dedupe_key, data, row_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 1)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [ev.id, ordinal, ev.profileId, ev.ownerId, ev.at, ev.dedupeKey, JSON.stringify(ev)],
    );
  }
}

function makeStagedJournal(ownerId: string, profileId: string, staged: StoredEvent[]): EventJournal {
  const seenKeys = new Set<string>();
  let lastError: EventError | null = null;
  return {
    append(owner, profId, dedupeKey, event, at = Date.now()) {
      const checked = validateEvent(event);
      if (!checked.ok) { lastError = checked.error; return { ok: false, error: checked.error }; }
      if (owner !== ownerId || profId !== profileId) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      if (!/^[a-zA-Z0-9_:-]{1,120}$/.test(dedupeKey)) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      if (seenKeys.has(dedupeKey)) {
        // Повтор того же шага не создаёт второе событие; id выводится из ключа.
        const existing = staged.find((e) => e.dedupeKey === dedupeKey)!;
        lastError = null;
        return { ok: true, stored: existing };
      }
      seenKeys.add(dedupeKey);
      const record: StoredEvent = {
        id: `ev_${randomUUID()}`,
        profileId: profId,
        ownerId: owner,
        at,
        dedupeKey,
        event: checked.event,
      };
      staged.push(record);
      lastError = null;
      return { ok: true, stored: record };
    },
    list(owner, profId) {
      // Чужой владелец не видит ничего, даже при совпадении profileId.
      if (owner !== ownerId || profId !== profileId) return [];
      return staged.filter((e) => e.ownerId === owner && e.profileId === profId);
    },
    removeProfile(profId) {
      const before = staged.length;
      for (let i = staged.length - 1; i >= 0; i--) {
        if (staged[i].profileId === profId) { seenKeys.delete(staged[i].dedupeKey); staged.splice(i, 1); }
      }
      return before - staged.length;
    },
    size: () => staged.length,
    lastError: () => lastError,
  };
}

export async function startOwnedSessionRowLevel(
  client: AsyncQueryable,
  parentId: string,
  profileId: string,
  options: {
    repeat?: boolean;
    storyChoice?: boolean;
    journey?: boolean;
    review?: boolean;
    reviewTopicId?: string;
    useGlobalSchemaFlag?: boolean;
  } = {},
) {
  await ensureRowLevelSchema(client, { useGlobalFlag: options.useGlobalSchemaFlag });
  return inRowTransaction(client, async () => {
    const profileRes = await client.query<{ data: Profile }>(
      'SELECT data FROM gib.profiles WHERE id = $1 AND parent_id = $2 FOR UPDATE',
      [profileId, parentId],
    );
    if (profileRes.rows.length === 0) return { error: 'profile_not_found' as const };
    const profile = profileRes.rows[0].data;
    const before = await loadVersionedSnapshot(client, profile);
    const working = makeSessionMemory(before);
    const stagedEvents: StoredEvent[] = [];
    working.store.journal = makeStagedJournal(parentId, profile.id, stagedEvents);
    working.store.ownerId = parentId;

    const firstSession = !options.repeat && !options.review && before.sessions.length === 0;
    const started = startSession(profile, Boolean(options.repeat), working.store, {
      storyChoice: options.storyChoice,
      journey: options.journey,
      review: options.review,
      reviewTopicId: options.reviewTopicId,
    });
    await persistRowChanges(client, before, working.state, stagedEvents);
    return { started, firstSession };
  });
}

export async function selectOwnedStoryRowLevel(
  client: AsyncQueryable,
  parentId: string,
  sessionId: string,
  cardId: string,
  options: { useGlobalSchemaFlag?: boolean } = {},
) {
  await ensureRowLevelSchema(client, { useGlobalFlag: options.useGlobalSchemaFlag });
  return inRowTransaction(client, async () => {
    const rows = await client.query<{ data: Profile }>(
      `SELECT p.data
         FROM gib.profiles p
         JOIN gib.sessions s ON s.profile_id = p.id
        WHERE p.parent_id = $1 AND s.id = $2
          FOR UPDATE OF p`,
      [parentId, sessionId],
    );
    if (rows.rows.length === 0) return { error: 'session_not_found' as const };
    const profile = rows.rows[0].data;
    const before = await loadVersionedSnapshot(client, profile);
    const working = makeSessionMemory(before);
    const stagedEvents: StoredEvent[] = [];
    working.store.journal = makeStagedJournal(parentId, profile.id, stagedEvents);
    working.store.ownerId = parentId;

    const result = selectSessionStory(sessionId, cardId, working.store);
    if ('error' in result) return result;

    await persistRowChanges(client, before, working.state, stagedEvents);
    const selected = working.store.getSession(sessionId);
    const rt = selected?.runtime;
    if (rt?.storyFlow?.version === 2) {
      return {
        ...result,
        item: publicItem(rt.items[rt.index], profile.band),
        step: rt.index,
        steps: rt.items.length,
      };
    }
    if (!rt && selected?.finishedAt) {
      return { ...result, finished: true };
    }
    return result;
  });
}

export async function answerOwnedSessionRowLevel(
  client: AsyncQueryable,
  parentId: string,
  sessionId: string,
  payload: AnswerPayload,
  ms: number,
  step: number,
  options: { useGlobalSchemaFlag?: boolean } = {},
) {
  await ensureRowLevelSchema(client, { useGlobalFlag: options.useGlobalSchemaFlag });
  return inRowTransaction(client, async () => {
    const rows = await client.query<{ data: Profile }>(
      `SELECT p.data
         FROM gib.profiles p
         JOIN gib.sessions s ON s.profile_id = p.id
        WHERE p.parent_id = $1 AND s.id = $2
          FOR UPDATE OF p`,
      [parentId, sessionId],
    );
    if (rows.rows.length === 0) return { error: 'session_not_found' as const };
    const profile = rows.rows[0].data;
    const before = await loadVersionedSnapshot(client, profile);
    const working = makeSessionMemory(before);
    const stagedEvents: StoredEvent[] = [];
    working.store.journal = makeStagedJournal(parentId, profile.id, stagedEvents);
    working.store.ownerId = parentId;

    const result = answerStep(sessionId, payload, ms, step, working.store);
    if ('error' in result) return result;
    await persistRowChanges(client, before, working.state, stagedEvents);
    return result;
  });
}

export async function getOwnedPlayerRowLevel(
  client: AsyncQueryable,
  parentId: string,
  profileId: string,
  options: { useGlobalSchemaFlag?: boolean } = {},
) {
  await ensureRowLevelSchema(client, { useGlobalFlag: options.useGlobalSchemaFlag });
  return inRowTransaction(client, async () => {
    const rows = await client.query<{ data: Profile }>(
      'SELECT data FROM gib.profiles WHERE id = $1 AND parent_id = $2 FOR UPDATE',
      [profileId, parentId],
    );
    if (rows.rows.length === 0) return { error: 'profile_not_found' as const };
    const profile = rows.rows[0].data;
    const before = await loadVersionedSnapshot(client, profile);
    const working = makeSessionMemory(before);
    const view = publicPlayer(profile.id, working.store);
    await persistRowChanges(client, before, working.state, []);
    return view;
  });
}

export async function actOnOwnedPlayerRowLevel(
  client: AsyncQueryable,
  parentId: string,
  profileId: string,
  action: 'claim' | 'buy' | 'equip',
  id: string,
  options: { useGlobalSchemaFlag?: boolean } = {},
) {
  await ensureRowLevelSchema(client, { useGlobalFlag: options.useGlobalSchemaFlag });
  return inRowTransaction(client, async () => {
    const rows = await client.query<{ data: Profile }>(
      'SELECT data FROM gib.profiles WHERE id = $1 AND parent_id = $2 FOR UPDATE',
      [profileId, parentId],
    );
    if (rows.rows.length === 0) return { error: 'profile_not_found' as const, status: 404 as const };
    const profile = rows.rows[0].data;
    const before = await loadVersionedSnapshot(client, profile);
    const working = makeSessionMemory(before);
    const player = working.store.playerState(profile.id);
    const program = working.store.programState(profile.id);
    if (!player.missions.ids.length) ensureMissions(player, program.completedDays);

    if (action === 'claim') {
      const reward = claimMission(player, id);
      if (!reward) return { error: 'not_ready' as const, status: 400 as const };
      working.store.setPlayerState(player);
      const view = publicPlayer(profile.id, working.store);
      await persistRowChanges(client, before, working.state, []);
      return { ok: true as const, reward, ...view };
    }

    const item = SHOP.find((i) => i.id === id);
    if (!item) return { error: 'unknown_item' as const, status: 404 as const };

    if (action === 'buy') {
      const bought = buyItem(player, item.id, item.price);
      if (!bought.ok) return { error: bought.error ?? 'invalid_action', status: 400 as const };
      player.equipped = { ...player.equipped, [item.slot]: item.id };
      working.store.setPlayerState(player);
      const view = publicPlayer(profile.id, working.store);
      await persistRowChanges(client, before, working.state, []);
      return { ok: true as const, ...view };
    }

    if (!player.inventory.includes(item.id)) {
      return { error: 'not_owned' as const, status: 400 as const };
    }
    player.equipped = { ...player.equipped, [item.slot]: item.id };
    working.store.setPlayerState(player);
    const view = publicPlayer(profile.id, working.store);
    await persistRowChanges(client, before, working.state, []);
    return { ok: true as const, ...view };
  });
}
