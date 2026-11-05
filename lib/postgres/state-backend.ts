/**
 * Хранилище в PostgreSQL с той же семантикой, что у JSON и SQLite.
 *
 * Почему так, а не «нормальный» асинхронный репозиторий. Игровое ядро
 * синхронное: награды, прогресс и событие пишутся в одной транзакции, и любая
 * асинхронность внутри сломала бы это молча. Поэтому транзакция читает
 * состояние, даёт коду менять его в памяти и в конце записывает **только
 * изменившиеся строки**. Поведение совпадает с SQLite один в один, и все
 * тесты движка остаются в силе.
 *
 * Цена честно: на транзакцию берётся блокировка `pg_advisory_xact_lock`,
 * поэтому писатели сериализуются (как `BEGIN IMMEDIATE` в SQLite). Для
 * прототипа это правильно; для высокой нагрузки нужен асинхронный клиент и
 * построчные блокировки — это записано в регламенте как ограничение.
 */
import { isDeepStrictEqual } from 'node:util';
import type { Payment, PlayerState, Profile, ProgramState, Session, SkillState, Subscription } from '../types.ts';
import type { StoredEvent } from '../events/journal.ts';
import { PgBridge as PgBridgeClass, pgBridge, type PgBridge, type PgRow } from './bridge.ts';

export type StateShape = {
  profiles: Profile[];
  skills: (SkillState & { profileId: string })[];
  sessions: Session[];
  subs: Subscription[];
  programStates: ProgramState[];
  playerStates: PlayerState[];
  payments: Payment[];
  events: StoredEvent[];
  parentPins: { parentId: string; pin: unknown }[];
  familySettings: { parentId: string; goalTarget: number }[];
  notificationSettings: { parentId: string; settings: unknown }[];
};

/** Блокировка писателей: тот же приём, что в миграции. */
export const WRITE_LOCK = 726391805;

type CollectionKey = keyof StateShape;

/**
 * Описание таблиц: где лежит запись целиком (`data`), какое поле — первичный
 * ключ и какие столбцы дублируют значения из JSON для проверок и поиска.
 */
type TableSpec = {
  table: string;
  /** Первичный ключ в терминах записи. */
  key: (row: Record<string, unknown>) => unknown[];
  /** Дополнительные столбцы, которые надо заполнять при insert. */
  columns: (row: Record<string, unknown>) => Record<string, unknown>;
  /** Имена столбцов первичного ключа в таблице. */
  keyColumns: string[];
};

const TABLES: Record<CollectionKey, TableSpec> = {
  profiles: {
    table: 'profiles',
    key: row => [row.id],
    keyColumns: ['id'],
    columns: row => ({ id: row.id, parent_id: row.parentId, age: row.age, band: row.band, created_at: row.createdAt }),
  },
  skills: {
    table: 'skills',
    key: row => [row.profileId, row.skill],
    keyColumns: ['profile_id', 'skill'],
    columns: row => ({ profile_id: row.profileId, skill: row.skill }),
  },
  sessions: {
    table: 'sessions',
    key: row => [row.id],
    keyColumns: ['id'],
    columns: row => ({ id: row.id, profile_id: row.profileId, started_at: row.startedAt, finished_at: row.finishedAt ?? null }),
  },
  subs: {
    table: 'subscriptions',
    key: row => [row.profileId],
    keyColumns: ['profile_id'],
    columns: row => ({ profile_id: row.profileId }),
  },
  programStates: {
    table: 'program_states',
    key: row => [row.profileId],
    keyColumns: ['profile_id'],
    columns: row => ({ profile_id: row.profileId }),
  },
  playerStates: {
    table: 'player_states',
    key: row => [row.profileId],
    keyColumns: ['profile_id'],
    columns: row => ({ profile_id: row.profileId }),
  },
  payments: {
    table: 'payments',
    key: row => [row.id],
    keyColumns: ['id'],
    columns: row => ({ id: row.id, profile_id: row.profileId, provider_id: row.providerId ?? null, status: row.status }),
  },
  events: {
    table: 'events',
    key: row => [row.id],
    keyColumns: ['id'],
    columns: row => ({ id: row.id, profile_id: row.profileId, owner_id: row.ownerId, at: row.at, dedupe_key: row.dedupeKey }),
  },
  parentPins: {
    table: 'parent_pins',
    key: row => [row.parentId],
    keyColumns: ['parent_id'],
    columns: row => ({ parent_id: row.parentId }),
  },
  familySettings: {
    table: 'family_settings',
    key: row => [row.parentId],
    keyColumns: ['parent_id'],
    columns: row => ({ parent_id: row.parentId, goal_target: row.goalTarget }),
  },
  notificationSettings: {
    table: 'notification_settings',
    key: row => [row.parentId],
    keyColumns: ['parent_id'],
    columns: row => ({ parent_id: row.parentId }),
  },
};

const STATE_KEYS = Object.keys(TABLES) as CollectionKey[];

/**
 * Имя схемы попадает в SQL, поэтому проверяем его здесь, а не у вызывающих:
 * никакой интерполяции произвольной строки в запрос.
 */
export function assertSchemaName(schema: string): string {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema)) throw new Error('invalid_schema_name');
  return schema;
}

/** Все таблицы состояния — для копий и проверок. */
export const STATE_TABLES: Readonly<string[]> = STATE_KEYS.map((name) => TABLES[name].table);

function keyOf(spec: TableSpec, row: Record<string, unknown>): string {
  return JSON.stringify(spec.key(row));
}

/**
 * Чтение всего состояния.
 *
 * Один запрос на коллекцию, порядок — по `ordinal` (порядок вставки). Чтение
 * целиком выбрано осознанно: это повторяет `store.all()` и делает семантику
 * неотличимой от SQLite.
 */
export function readState(bridge: PgBridge, schema = 'gib'): StateShape {
  assertSchemaName(schema);
  const state = {} as StateShape;
  for (const name of STATE_KEYS) {
    const spec = TABLES[name];
    const rows = bridge.query(`SELECT data FROM ${schema}.${spec.table} ORDER BY ordinal`);
    (state as unknown as Record<string, unknown[]>)[name] = rows.map(row => row.data as Record<string, unknown>);
  }
  return state;
}

/** Записать разницу между прежним и новым состоянием. Только изменённое. */
export function writeState(bridge: PgBridge, before: StateShape, after: StateShape, schema = 'gib'): { written: number; deleted: number } {
  assertSchemaName(schema);
  let written = 0;
  let deleted = 0;
  for (const name of STATE_KEYS) {
    const spec = TABLES[name];
    const previous = new Map(((before as unknown as Record<string, Record<string, unknown>[]>)[name] ?? []).map(row => [keyOf(spec, row), row]));
    const next = ((after as unknown as Record<string, Record<string, unknown>[]>)[name] ?? []);

    for (const row of next) {
      const key = keyOf(spec, row);
      const old = previous.get(key);
      if (old && isDeepStrictEqual(old, row)) continue;
      const cols = spec.columns(row);
      const names = Object.keys(cols);
      if (old) {
        // Обновление: ordinal не трогаем, он держит порядок чтения.
        //
        // `data` пишется ВСЕГДА. Раньше обновление пропускалось, если у таблицы
        // все колонки — первичный ключ (например `player_states`): тогда
        // изменения не попадали в базу вовсе. Это ловит тест флоу.
        const extra = names.filter(c => !spec.keyColumns.includes(c));
        const values = extra.map(c => cols[c]);
        const sets = extra.map((c, i) => `${c} = $${i + 1}`);
        sets.push('data = $' + (values.length + 1) + '::jsonb');
        values.push(JSON.stringify(row));
        const where = spec.keyColumns.map((c, i) => `${c} = $${values.length + i + 1}`).join(' AND ');
        values.push(...spec.keyColumns.map(c => cols[c]));
        bridge.query(`UPDATE ${schema}.${spec.table} SET ${sets.join(', ')} WHERE ${where}`, values);
      } else {
        const ordinal = bridge.query(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM ${schema}.${spec.table}`)[0]?.next;
        const allNames = [...names, 'ordinal', 'data'];
        const values = [...names.map(c => cols[c]), ordinal, JSON.stringify(row)];
        const placeholders = allNames.map((c, i) => (c === 'data' ? `$${i + 1}::jsonb` : `$${i + 1}`));
        bridge.query(`INSERT INTO ${schema}.${spec.table} (${allNames.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
      }
      written++;
    }

    // Удаления: ключи, которых больше нет. Только по существующим первичным ключам.
    const nextKeys = new Set(next.map(row => keyOf(spec, row)));
    for (const [key, row] of previous) {
      if (nextKeys.has(key)) continue;
      const cols = spec.columns(row);
      const where = spec.keyColumns.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
      bridge.query(`DELETE FROM ${schema}.${spec.table} WHERE ${where}`, spec.keyColumns.map(c => cols[c]));
      deleted++;
    }
  }
  return { written, deleted };
}

/**
 * Обёртка транзакции.
 *
 * Блокировка писателей берётся сразу: два процесса не должны читать состояние
 * одновременно и затирать изменения друг друга. Это тот же запрет, что
 * `BEGIN IMMEDIATE` в SQLite, только на стороне сервера.
 */
export function runTransaction<T>(bridge: PgBridge, fn: (load: () => StateShape) => T): T {
  bridge.exec('BEGIN');
  try {
    bridge.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
    // `before` — снимок для сравнения, `working` — то, что меняет код.
    // Без копии сравнение не увидело бы изменений: это был бы один объект.
    const before = readState(bridge);
    const working = structuredClone(before);
    const load = (): StateShape => working;
    const result = fn(load);
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('Async transaction is not supported');
    writeState(bridge, before, working);
    bridge.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      bridge.exec('ROLLBACK');
    } catch {
      /* исходная ошибка важнее */
    }
    throw error;
  }
}

/**
 * Создание схемы без асинхронности: тот же SQL, что в миграции, но через мост.
 *
 * Нужно при первом запуске в режиме PostgreSQL: приложение не может await-ить
 * миграцию, поэтому она выполняется здесь в одной транзакции под advisory-замком.
 */
export function ensureSchemaSync(bridge: PgBridge, schema: { v1: string; v2: string }): void {
  bridge.exec('BEGIN');
  try {
    bridge.query('SELECT pg_advisory_xact_lock($1)', [726391804]);
    bridge.exec('CREATE SCHEMA IF NOT EXISTS gib');
    bridge.exec('CREATE TABLE IF NOT EXISTS gib.schema_version (id SMALLINT PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, imported_at TIMESTAMPTZ)');
    const current = bridge.query('SELECT version FROM gib.schema_version WHERE id = 1');
    const version = current.length ? Number(current[0].version) : 0;
    if (version === 0) {
      for (const statement of schema.v1.split(';').map(s => s.trim()).filter(Boolean)) bridge.exec(statement);
      for (const statement of schema.v2.split(';').map(s => s.trim()).filter(Boolean)) bridge.exec(statement);
      bridge.query('INSERT INTO gib.schema_version (id, version) VALUES (1, $1)', [2]);
    } else if (version === 1) {
      for (const statement of schema.v2.split(';').map(s => s.trim()).filter(Boolean)) bridge.exec(statement);
      bridge.query('UPDATE gib.schema_version SET version = 2 WHERE id = 1');
    } else if (version !== 2) {
      throw new Error('Unsupported PostgreSQL schema version: ' + version);
    }
    bridge.exec('COMMIT');
  } catch (error) {
    try {
      bridge.exec('ROLLBACK');
    } catch {
      /* исходная ошибка важнее */
    }
    throw error;
  }
}

function bridgeOptions(env: NodeJS.ProcessEnv) {
  return {
    connectionString: env.GIB_POSTGRES_URL || env.DATABASE_URL,
    dataDir: env.GIB_PG_DIR,
    timeoutMs: Number(env.GIB_PG_TIMEOUT_MS) || 30_000,
  };
}

/**
 * Готовое соединение по окружению — общее на процесс.
 *
 * `pgBridge` переиспользует один мост, поэтому закрывать его может только
 * завершение процесса. Для одноразовых задач (CLI, миграции) есть
 * `openDetachedBridge`: он живёт отдельно и закрывается явно.
 */
export function openBridge(env: NodeJS.ProcessEnv = process.env): PgBridge {
  return pgBridge(bridgeOptions(env));
}

/** Собственный мост для одноразовой задачи: не делится с приложением. */
export function openDetachedBridge(env: NodeJS.ProcessEnv = process.env): PgBridge {
  return new PgBridgeClass(bridgeOptions(env));
}

/** Проверка, что база отвечает: используется готовностью. */
export function pingDatabase(bridge: PgBridge): { ok: boolean; mode: string; detail: string } {
  try {
    const info = bridge.query("SELECT current_database() AS db, version() AS version")[0] as PgRow | undefined;
    const db = String(info?.db ?? 'unknown');
    return { ok: true, mode: 'postgres', detail: `база ${db}` };
  } catch (error) {
    return { ok: false, mode: 'postgres', detail: (error as Error).message };
  }
}
