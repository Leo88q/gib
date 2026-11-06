/**
 * Схема хранилища. Версия 2 добавляет состояние аккаунта и лимиты, которые
 * раньше жили только рядом с коллекциями в JSON/SQLite.
 *
 * Что где хранится: идентичность и значения, по которым ищут, — в столбцах;
 * остальное — в JSONB с проверкой, что столбцы и JSON не разошлись. Так запрос
 * не зависит от формы записи, а рассинхрон ловится ограничением, а не отчётом.
 */
export const SCHEMA_VERSION = 2;
export const LOCK_ID = 726391804;
export const TABLES = ['profiles', 'skills', 'sessions', 'subscriptions', 'program_states', 'player_states', 'payments', 'events'] as const;

/** Таблицы состояния аккаунта: не данные ребёнка, но нужны для работы. */
export const ACCOUNT_TABLES = ['parent_pins', 'family_settings', 'notification_settings', 'rate_limits'] as const;
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
CREATE TABLE gib.events (
  id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), profile_id TEXT NOT NULL REFERENCES gib.profiles(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, at BIGINT NOT NULL CHECK (at >= 0), dedupe_key TEXT NOT NULL UNIQUE, data JSONB NOT NULL,
  CHECK (jsonb_typeof(data)='object' AND data->>'id' IS NOT DISTINCT FROM id AND data->>'profileId' IS NOT DISTINCT FROM profile_id
    AND data->>'ownerId' IS NOT DISTINCT FROM owner_id AND data->>'at' IS NOT DISTINCT FROM at::text AND data->>'dedupeKey' IS NOT DISTINCT FROM dedupe_key)
);
CREATE INDEX events_profile_at ON gib.events(profile_id, at DESC);
`;

/**
 * Схема v2: то, что раньше жило вне коллекций.
 *
 * - `parent_pins` — только scrypt-хеш и соль, без самого PIN;
 * - `family_settings` — размер общей цели, одно число на владельца;
 * - `notification_settings` — частоты сообщений взрослому;
 * - `rate_limits` — окна лимитов запросов (общие для инстансов).
 *
 * Внешних ключей на `profiles` нет намеренно: PIN и настройки принадлежат
 * **владельцу** (взрослому), а не профилю ребёнка, и должны переживать удаление
 * одного ребёнка.
 */
export const SCHEMA_V2 = `
-- Схема v1 запрещала второму ребёнку того же взрослого (parent_id UNIQUE).
-- Приложение поддерживает семью с несколькими детьми, поэтому ограничение
-- снимается, а поиск по владельцу остаётся быстрым за счёт индекса.
ALTER TABLE gib.profiles DROP CONSTRAINT IF EXISTS profiles_parent_id_key;
CREATE INDEX IF NOT EXISTS profiles_parent ON gib.profiles(parent_id);
CREATE TABLE gib.parent_pins (
  parent_id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data) = 'object' AND data->>'parentId' IS NOT DISTINCT FROM parent_id)
);
CREATE TABLE gib.family_settings (
  parent_id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), goal_target INTEGER NOT NULL CHECK (goal_target BETWEEN 4 AND 60), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data) = 'object' AND data->>'parentId' IS NOT DISTINCT FROM parent_id AND (data->>'goalTarget')::int IS NOT DISTINCT FROM goal_target)
);
CREATE TABLE gib.notification_settings (
  parent_id TEXT PRIMARY KEY, ordinal BIGINT NOT NULL UNIQUE CHECK (ordinal >= 0), data JSONB NOT NULL,
  CHECK (jsonb_typeof(data) = 'object' AND data->>'parentId' IS NOT DISTINCT FROM parent_id)
);
CREATE TABLE gib.rate_limits (
  bucket_key TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK (count >= 0), reset_at BIGINT NOT NULL CHECK (reset_at >= 0)
);
CREATE INDEX rate_limits_reset ON gib.rate_limits(reset_at);
`;
