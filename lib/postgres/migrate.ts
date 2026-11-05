import { isDeepStrictEqual } from 'node:util';
import { validateStore, STORE_COLLECTIONS } from '../store-validation.ts';
import { LOCK_ID, SCHEMA_V1, SCHEMA_V2, SCHEMA_VERSION, TABLES } from './schema.ts';

export interface SqlClient { query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
export type LegacyState = Record<typeof STORE_COLLECTIONS[number], Record<string, unknown>[]>;
const rows = (value: unknown) => value as Record<string, unknown>[];
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reject orphans/invalid identities before opening a write transaction. Never silently drop a record. */
export function prepareImport(value: unknown): LegacyState {
  validateStore(value);
  const input = value as Record<string, unknown>;
  const state = Object.fromEntries(STORE_COLLECTIONS.map(k => [k, input[k] === undefined ? [] : rows(input[k])])) as LegacyState;
  const parents = new Set<string>(); const profiles = new Set<string>(); const providers = new Set<string>();
  for (const p of state.profiles) {
    if (!nonempty(p.id) || !nonempty(p.parentId) || parents.has(p.parentId) || !Number.isInteger(p.age) ||
        typeof p.age !== 'number' || p.age < 5 || p.age > 13 || p.band !== (p.age < 8 ? '5-7' : p.age < 11 ? '8-10' : '11-13') ||
        typeof p.name !== 'string' || !timestamp(p.createdAt)) throw new Error('Invalid or duplicate profile for PostgreSQL import');
    profiles.add(p.id); parents.add(p.parentId);
  }
  for (const key of STORE_COLLECTIONS.filter(k => k !== 'profiles')) {
    for (const row of state[key]) if (!nonempty(row.profileId) || !profiles.has(row.profileId)) throw new Error(`Orphan record in ${key}`);
  }
  for (const s of state.sessions) if (!timestamp(s.startedAt) || (s.finishedAt !== undefined && !timestamp(s.finishedAt))) throw new Error('Invalid session timestamp');
  for (const s of state.skills) if (!['attention','working_memory','flexibility','inhibition','planning','logic'].includes(String(s.skill))) throw new Error('Invalid skill');
  for (const p of state.payments) {
    if (p.providerId !== undefined && (!nonempty(p.providerId) || providers.has(p.providerId))) throw new Error('Invalid or duplicate provider identifier');
    if (typeof p.providerId === 'string') providers.add(p.providerId);
  }
  return state;
}

async function transaction<T>(client: SqlClient, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try { const result = await fn(); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
}

/** Serialises schema setup between cooperating migration processes. */
export async function ensureSchema(client: SqlClient): Promise<void> {
  await transaction(client, async () => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    await client.query('CREATE SCHEMA IF NOT EXISTS gib');
    await client.query('CREATE TABLE IF NOT EXISTS gib.schema_version (id SMALLINT PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, imported_at TIMESTAMPTZ)');
    const current = await client.query('SELECT version FROM gib.schema_version WHERE id=1');
    if (current.rows.length) {
      const version = Number(current.rows[0].version);
      // Обновление 1 → 2 идемпотентно и не трогает данные: только новые таблицы.
      if (version === SCHEMA_VERSION) return;
      if (version !== 1) throw new Error('Unsupported PostgreSQL schema version');
      for (const statement of SCHEMA_V2.split(';').map(s => s.trim()).filter(Boolean)) await client.query(statement);
      await client.query('UPDATE gib.schema_version SET version = $1 WHERE id = 1', [SCHEMA_VERSION]);
      return;
    }
    // No IF NOT EXISTS: a partially pre-existing schema must fail closed, not be adopted.
    for (const statement of SCHEMA_V1.split(';').map(s => s.trim()).filter(Boolean)) await client.query(statement);
    for (const statement of SCHEMA_V2.split(';').map(s => s.trim()).filter(Boolean)) await client.query(statement);
    await client.query('INSERT INTO gib.schema_version (id, version) VALUES (1, $1)', [SCHEMA_VERSION]);
  });
}

/** Caller must stop legacy writers. Locks prevent concurrent writes to destination tables. */
export async function importLegacy(client: SqlClient, input: unknown): Promise<Record<string, number>> {
  const state = prepareImport(input);
  return transaction(client, async () => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    const version = await client.query('SELECT version, imported_at FROM gib.schema_version WHERE id=1');
    if (version.rows.length !== 1 || Number(version.rows[0].version) !== SCHEMA_VERSION) throw new Error('Unsupported PostgreSQL schema version');
    if (version.rows[0].imported_at !== null) throw new Error('PostgreSQL import already completed');
    await client.query(`LOCK TABLE ${TABLES.map(t => `gib.${t}`).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of TABLES) {
      const count = await client.query(`SELECT count(*) AS n FROM gib.${table}`);
      if (Number(count.rows[0].n) !== 0) throw new Error('PostgreSQL destination is not empty');
    }
    for (const [i,p] of state.profiles.entries()) await client.query('INSERT INTO gib.profiles(id,ordinal,parent_id,age,band,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [p.id, i, p.parentId, p.age, p.band, p.createdAt, JSON.stringify(p)]);
    for (const [i,s] of state.skills.entries()) await client.query('INSERT INTO gib.skills(profile_id,ordinal,skill,data) VALUES($1,$2,$3,$4::jsonb)', [s.profileId, i, s.skill, JSON.stringify(s)]);
    for (const [i,s] of state.sessions.entries()) await client.query('INSERT INTO gib.sessions(id,ordinal,profile_id,started_at,finished_at,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [s.id, i, s.profileId, s.startedAt, s.finishedAt ?? null, JSON.stringify(s)]);
    for (const [i,s] of state.subs.entries()) await client.query('INSERT INTO gib.subscriptions(profile_id,ordinal,data) VALUES($1,$2,$3::jsonb)', [s.profileId, i, JSON.stringify(s)]);
    for (const [i,s] of state.programStates.entries()) await client.query('INSERT INTO gib.program_states(profile_id,ordinal,data) VALUES($1,$2,$3::jsonb)', [s.profileId, i, JSON.stringify(s)]);
    for (const [i,s] of state.playerStates.entries()) await client.query('INSERT INTO gib.player_states(profile_id,ordinal,data) VALUES($1,$2,$3::jsonb)', [s.profileId, i, JSON.stringify(s)]);
    for (const [i,p] of state.payments.entries()) await client.query('INSERT INTO gib.payments(id,ordinal,profile_id,provider_id,status,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [p.id, i, p.profileId, p.providerId ?? null, p.status, JSON.stringify(p)]);
    for (const [i,e] of state.events.entries()) await client.query('INSERT INTO gib.events(id,ordinal,profile_id,owner_id,at,dedupe_key,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [e.id, i, e.profileId, e.ownerId, e.at, e.dedupeKey, JSON.stringify(e)]);
    // Verify every record and original array order before the transaction is committed.
    const mapping: Record<typeof STORE_COLLECTIONS[number], typeof TABLES[number]> = {
      profiles: 'profiles', skills: 'skills', sessions: 'sessions', subs: 'subscriptions',
      programStates: 'program_states', playerStates: 'player_states', payments: 'payments', events: 'events',
    };
    for (const key of STORE_COLLECTIONS) {
      const actual = await client.query(`SELECT data FROM gib.${mapping[key]} ORDER BY ordinal`);
      const expected = JSON.parse(JSON.stringify(state[key]));
      if (!isDeepStrictEqual(actual.rows.map(row => row.data), expected)) throw new Error(`PostgreSQL verification failed: ${key}`);
    }
    await client.query('UPDATE gib.schema_version SET imported_at = CURRENT_TIMESTAMP WHERE id = 1');
    return Object.fromEntries(STORE_COLLECTIONS.map(k => [k, state[k].length]));
  });
}
