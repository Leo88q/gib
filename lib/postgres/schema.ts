/**
 * Схема хранилища. Версия 2 добавляет состояние аккаунта и лимиты, которые
 * раньше жили только рядом с коллекциями в JSON/SQLite.
 *
 * Что где хранится: идентичность и значения, по которым ищут, — в столбцах;
 * остальное — в JSONB с проверкой, что столбцы и JSON не разошлись. Так запрос
 * не зависит от формы записи, а рассинхрон ловится ограничением, а не отчётом.
 */
export const SCHEMA_VERSION = 3;
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

/**
 * Схема v3: продажа доступа.
 *
 * Версия 2 знала о платежах только четыре состояния и не знала о возврате.
 * Возврат появился как обязательная часть продажи (оферта обещает 14 дней),
 * и без миграции первый же возврат падал бы на CHECK-ограничении status —
 * причём падал бы не в тесте, а у покупателя.
 *
 * Что добавляется:
 *  - статусы `refunded` и `refund_pending` в платеже и их идентификаторы:
 *    `refunded_at`, `provider_refund_id` (защита от второго возврата),
 *    `canceled_at`;
 *  - `receipt_email` и `offer_version` — чек и редакция оферты относятся к
 *    конкретному расчёту, поэтому лежат в платеже, а не в профиле;
 *  - режим встречи и ответ про взрослого в профиле: от них зависит, что
 *    продаётся (в режиме «ребёнок сам» встречи не продаются вовсе).
 *
 * Столбцы выводятся из JSONB теми же выражениями, что и в v1, поэтому
 * существующие строки заполняются миграцией без отдельного скрипта.
 */
export const SCHEMA_V3 = `
ALTER TABLE gib.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE gib.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('creating','pending','succeeded','canceled','refunded','refund_pending'));
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS applied_at BIGINT CHECK (applied_at >= 0);
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS canceled_at BIGINT CHECK (canceled_at >= 0);
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS refunded_at BIGINT CHECK (refunded_at >= 0);
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS provider_refund_id TEXT;
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS receipt_email TEXT;
ALTER TABLE gib.payments ADD COLUMN IF NOT EXISTS offer_version TEXT;
UPDATE gib.payments SET
  applied_at = (data->>'appliedAt')::bigint,
  canceled_at = (data->>'canceledAt')::bigint,
  refunded_at = (data->>'refundedAt')::bigint,
  provider_refund_id = data->>'providerRefundId',
  receipt_email = data->>'receiptEmail',
  offer_version = data->>'offerVersion';
-- Один возврат на платёж: провайдерский идентификатор возврата уникален.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_refund ON gib.payments(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
ALTER TABLE gib.profiles ADD COLUMN IF NOT EXISTS meeting_lead TEXT;
ALTER TABLE gib.profiles ADD COLUMN IF NOT EXISTS household_adult TEXT;
UPDATE gib.profiles SET meeting_lead = data->>'meetingLead', household_adult = data->>'householdAdult';
ALTER TABLE gib.profiles DROP CONSTRAINT IF EXISTS profiles_meeting_lead_check;
ALTER TABLE gib.profiles ADD CONSTRAINT profiles_meeting_lead_check
  CHECK (meeting_lead IS NULL OR meeting_lead IN ('adult','child'));
ALTER TABLE gib.profiles DROP CONSTRAINT IF EXISTS profiles_household_adult_check;
ALTER TABLE gib.profiles ADD CONSTRAINT profiles_household_adult_check
  CHECK (household_adult IS NULL OR household_adult IN ('parent','other','none'));
`;

/**
 * Таблица событий воронки запуска.
 *
 * Не входит в `SCHEMA_VERSION`: воронка — не состояние ребёнка, у неё свой
 * срок хранения (400 дней) и своё правило «переживает удаление профиля».
 * Поэтому таблица поднимается отдельно и идемпотентно
 * (`lib/events/funnel-store.ts`), а версия схемы состояния от неё не зависит.
 *
 * Первичный ключ и есть дедупликация: шаг считается один раз на владельца, а
 * отказ у оплаты — один раз на владельца и встречу. `lesson_number = 0`
 * означает «у шага нет встречи», а не «встреча номер ноль».
 *
 * Внешнего ключа на `gib.profiles` нет намеренно: иначе удаление ребёнка
 * стирало бы статистику продаж, и решение о запуске принималось бы по
 * испорченным числам.
 */
export const FUNNEL_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS gib;
CREATE TABLE IF NOT EXISTS gib.funnel_events (
  step TEXT NOT NULL,
  owner_id TEXT NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 200),
  at BIGINT NOT NULL CHECK (at >= 0),
  lesson_number INTEGER NOT NULL DEFAULT 0 CHECK (lesson_number >= 0),
  PRIMARY KEY (step, owner_id, lesson_number)
);
CREATE INDEX IF NOT EXISTS funnel_events_at ON gib.funnel_events(at);
`;
