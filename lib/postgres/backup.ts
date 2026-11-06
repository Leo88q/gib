/**
 * Снимок состояния PostgreSQL для резервной копии.
 *
 * Зачем отдельный модуль. Шифрование (`lib/encrypted-backup.ts`) уже не знает,
 * откуда взялся файл, — ему нужен только снимок. Не хватало ровно одного:
 * способа получить переносимый снимок из PostgreSQL, а не из файла SQLite.
 *
 * Что попадает в снимок: все таблицы состояния и аккаунта из `gib.*`, каждая
 * строка целиком — вместе с JSONB, а не только столбцы. Это позволяет
 * восстановить данные без опоры на форму записи приложения: если завтра
 * появится новая колонка, старый снимок всё равно читается.
 *
 * Чего здесь нет намеренно: `rate_limits` в снимок **не** попадает как данные
 * для восстановления (это счётчики окон, они живут минуты), но таблица
 * сохраняется пустой, чтобы восстановленная база сразу принимала запросы.
 *
 * Снимок не заменяет `pg_dump`: он не сохраняет роли, расширения и настройки
 * кластера. Для переноса базы целиком нужен `pg_dump`, и это записано в
 * регламенте, а не выдано за полноценную замену.
 */
import fs from 'node:fs';
import type { PgBridge } from './bridge.ts';

export type PgSnapshotTable = { name: string; rows: Record<string, unknown>[] };

export type PgSnapshot = {
  format: 'gib-pg-snapshot';
  version: 1;
  createdAt: number;
  database: string;
  schemaVersion: number;
  tables: PgSnapshotTable[];
};

/** Таблицы, которые попадают в снимок как данные. */
export const SNAPSHOT_TABLES = [
  'profiles', 'skills', 'sessions', 'subscriptions', 'program_states',
  'player_states', 'payments', 'events',
  'parent_pins', 'family_settings', 'notification_settings',
] as const;

/** Счётчики лимитов: таблица нужна, но данные в копии не храним. */
export const EPHEMERAL_TABLES = ['rate_limits'] as const;

function tableExists(bridge: PgBridge, table: string): boolean {
  const rows = bridge.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'gib' AND table_name = $1",
    [table],
  );
  return rows.length > 0;
}

/**
 * Читает состояние в переносимый снимок.
 *
 * `BEGIN … REPEATABLE READ` намеренно не используется: мост синхронный и уже
 * держит advisory-замок писателей внутри транзакции приложения. Здесь важен
 * другой риск — прочитать половину записи. Его нет: каждая строка пишется
 * одной командой, поэтому строка либо есть целиком, либо её нет. Согласованность
 * между таблицами может поехать на одну транзакцию, и это честно указано в
 * отчёте: для точной копии «в один момент» нужен `pg_dump` с транзакцией.
 */
export function readPgSnapshot(bridge: PgBridge, now = Date.now()): PgSnapshot {
  const info = bridge.query('SELECT current_database() AS db')[0];
  const versionRow = tableExists(bridge, 'schema_version')
    ? bridge.query('SELECT version FROM gib.schema_version WHERE id = 1')[0]
    : undefined;
  const tables: PgSnapshotTable[] = [];
  for (const name of SNAPSHOT_TABLES) {
    if (!tableExists(bridge, name)) throw new Error(`PostgreSQL snapshot: missing table gib.${name}`);
    tables.push({ name, rows: bridge.query(`SELECT * FROM gib.${name}`) });
  }
  return {
    format: 'gib-pg-snapshot',
    version: 1,
    createdAt: now,
    database: String(info?.db ?? 'unknown'),
    schemaVersion: Number(versionRow?.version ?? 0),
    tables,
  };
}

/** Записывает снимок в файл: 0o600, атомарная публикация через hard link. */
export function writePgSnapshot(snapshot: PgSnapshot, target: string): void {
  const tmp = `${target}.part-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
  try {
    const fd = fs.openSync(tmp, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Отказ, если целевой файл уже существует: копия не перетирает копию.
    fs.linkSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Проверяет форму снимка до того, как его будут шифровать или восстанавливать. */
export function verifyPgSnapshot(snapshot: unknown): asserts snapshot is PgSnapshot {
  const value = snapshot as PgSnapshot;
  if (!value || value.format !== 'gib-pg-snapshot') throw new Error('Not a PostgreSQL snapshot');
  if (value.version !== 1) throw new Error(`Unsupported snapshot version: ${value.version}`);
  if (!Array.isArray(value.tables)) throw new Error('Snapshot has no tables');
  const names = new Set(value.tables.map(t => t.name));
  for (const required of SNAPSHOT_TABLES) {
    if (!names.has(required)) throw new Error(`Snapshot is missing table ${required}`);
  }
  for (const table of value.tables) {
    if (!Array.isArray(table.rows)) throw new Error(`Snapshot table ${table.name} has no rows array`);
  }
}
