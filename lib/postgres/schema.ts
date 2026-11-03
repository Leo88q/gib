/** Experimental schema v1. Identity and queryable values are relational; per-record details remain JSONB. */
export const SCHEMA_VERSION = 1;
export const LOCK_ID = 726391804;
export const TABLES = ['profiles', 'skills', 'sessions', 'subscriptions', 'program_states', 'player_states', 'payments'] as const;
export const SCHEMA_V1 = `
CREATE TABLE gib.profiles (
  id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), parent_id TEXT NOT NULL UNIQUE, age SMALLINT NOT NULL CHECK (age BETWEEN 5 AND 13),
  band TEXT NOT NULL CHECK ((age BETWEEN 5 AND 7 AND band='5-7') OR (age BETWEEN 8 AND 10 AND band='8-10') OR (age BETWEEN 11 AND 13 AND band='11-13')),
  created_at BIGINT NOT NULL CHECK (created_at >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data) = 'object' AND data->>'id' IS NOT DISTINCT FROM id AND data->>'parentId' IS NOT DISTINCT FROM parent_id
    AND data->>'age' IS NOT DISTINCT FROM age::text AND data->>'band' IS NOT DISTINCT FROM band AND data->>'createdAt' IS NOT DISTINCT FROM created_at::text)
);
CREATE TABLE gib.skills (
  profile_id TEXT NOT NULL REFERENCES gib.profiles(id) ON DELETE CASCADE, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0),
  skill TEXT NOT NULL CHECK (skill IN ('attention','working_memory','flexibility','inhibition','planning','logic')), data JSONB NOT NULL,
  PRIMARY KEY(profile_id, skill),
  CHECK (jsonb_typeof(data)='object' AND data->>'profileId' IS NOT DISTINCT FROM profile_id AND data->>'skill' IS NOT DISTINCT FROM skill)
);
CREATE TABLE gib.sessions (
  id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), profile_id TEXT NOT NULL REFERENCES gib.profiles(id) ON DELETE CASCADE,
  started_at BIGINT NOT NULL CHECK (started_at >= 0), finished_at BIGINT CHECK (finished_at >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'id' IS NOT DISTINCT FROM id AND data->>'profileId' IS NOT DISTINCT FROM profile_id
    AND data->>'startedAt' IS NOT DISTINCT FROM started_at::text AND data->>'finishedAt' IS NOT DISTINCT FROM finished_at::text)
);
CREATE INDEX sessions_profile_started ON gib.sessions(profile_id, started_at DESC);
CREATE TABLE gib.subscriptions (
  profile_id TEXT PRIMARY KEY REFERENCES gib.profiles(id) ON DELETE CASCADE, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'profileId' IS NOT DISTINCT FROM profile_id)
);
CREATE TABLE gib.program_states (
  profile_id TEXT PRIMARY KEY REFERENCES gib.profiles(id) ON DELETE CASCADE, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'profileId' IS NOT DISTINCT FROM profile_id)
);
CREATE TABLE gib.player_states (
  profile_id TEXT PRIMARY KEY REFERENCES gib.profiles(id) ON DELETE CASCADE, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'profileId' IS NOT DISTINCT FROM profile_id)
);
CREATE TABLE gib.payments (
  id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), profile_id TEXT NOT NULL REFERENCES gib.profiles(id) ON DELETE RESTRICT,
  provider_id TEXT UNIQUE, status TEXT NOT NULL CHECK (status IN ('creating','pending','succeeded','canceled')), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'id' IS NOT DISTINCT FROM id AND data->>'profileId' IS NOT DISTINCT FROM profile_id
    AND data->>'providerId' IS NOT DISTINCT FROM provider_id AND data->>'status' IS NOT DISTINCT FROM status)
);
CREATE INDEX payments_profile_status ON gib.payments(profile_id, status);
`;
