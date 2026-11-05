/**
 * Снятие исторических меток оценки с хранилища любого режима.
 *
 * Раньше чистка умела только SQLite, хотя приложение умеет три хранилища.
 * Теперь формат определяется по содержимому, а не по расширению:
 *   --json <db.json>       файл состояния приложения
 *   --sqlite <db.sqlite>   база с таблицей app_state
 *   --postgres             PGlite-каталог (GIB_PG_DIR) или сервер (GIB_POSTGRES_URL)
 *
 * Правило одно для всех: исходник не правится никогда. JSON и SQLite
 * публикуются атомарной копией, PostgreSQL — отдельной схемой-копией,
 * которую владелец включает сам.
 *
 * Использование:
 *   npx tsx scripts/clean-story-quality.ts --dry-run <источник>
 *   npx tsx scripts/clean-story-quality.ts --copy <источник> <новый-файл>
 *   npx tsx scripts/clean-story-quality.ts --copy --postgres gib_cleaned
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { cleanStoryQuality, type StoryQualityCleanupCounts } from '../lib/story-quality-cleanup.ts';

/** Нули того же вида, что возвращает реальный проход: форма ответа одна. */
const EMPTY_COUNTS: StoryQualityCleanupCounts = {
  finishedLabelsRemoved: 0,
  activeLabelsRemoved: 0,
  activeLabelsDeferred: 0,
  activeSnapshotsRemoved: 0,
  activeSnapshotsDeferred: 0,
  receiptLabelsRemoved: 0,
  receiptLabelsDeferred: 0,
  sessionsChanged: 0,
};
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';
import { openDetachedBridge, readState, writeState, STATE_TABLES } from '../lib/postgres/state-backend.ts';

export type SourceKind = 'json' | 'sqlite' | 'postgres';

export type CleanupResult = {
  kind: SourceKind;
  mode: 'dry-run' | 'copy';
  counts: StoryQualityCleanupCounts;
  /** Куда положена очищенная копия; пусто в сухом прогоне. */
  target?: string;
};

/** Формат по содержимому: так файл нельзя «не так назвать» и испортить. */
export function detectSourceKind(file: string): SourceKind {
  const stat = fs.statSync(file);
  if (stat.isDirectory()) return 'postgres'; // каталог PGlite
  if (!stat.isFile()) throw new Error('invalid_source');
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString('utf8', 0, 15) === 'SQLite format 3') return 'sqlite';
  // JSON-состояние начинается с объекта; BOM и пробелы допускаются.
  const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('{')) return 'json';
  throw new Error('unknown_source_format');
}

/** Один и тот же результат для копии и для проверки: без скрытых изменений. */
function cleanOrThrow(raw: unknown): { state: Record<string, unknown>; counts: StoryQualityCleanupCounts } {
  const cleaned = cleanStoryQuality(raw, { deferActive: false });
  return { state: cleaned.state, counts: cleaned.counts };
}

/* ------------------------------- JSON ------------------------------- */

function readJsonState(file: string): unknown {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_json_state');
  }
}

function publishFile(temp: string, target: string): void {
  const fd = fs.openSync(temp, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // link не перезаписывает существующий файл и не идёт по символической ссылке.
  fs.linkSync(temp, target);
}

export function cleanJson(source: string, target?: string): StoryQualityCleanupCounts {
  const original = readJsonState(source);
  const { state, counts } = cleanOrThrow(original);
  if (!target) return counts;
  const dir = fs.mkdtempSync(path.join(path.dirname(target), '.gib-cleanup-'));
  const temp = path.join(dir, 'state.json');
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    publishFile(temp, target);
    fs.chmodSync(target, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return counts;
}

/* ------------------------------ SQLite ------------------------------ */

async function snapshotSqlite(source: string, temp: string): Promise<void> {
  // Даже превью идёт через backup API: он видит согласованное состояние WAL.
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(src, temp);
  } finally {
    src.close();
  }
  fs.chmodSync(temp, 0o600);
  verifySqliteSnapshot(temp);
}

export async function cleanSqlite(source: string, target?: string): Promise<StoryQualityCleanupCounts> {
  const dir = fs.mkdtempSync(path.join(target ? path.dirname(target) : os.tmpdir(), '.gib-cleanup-'));
  const temp = path.join(dir, 'snapshot.sqlite');
  let copy: DatabaseSync | undefined;
  try {
    await snapshotSqlite(source, temp);
    copy = new DatabaseSync(temp);
    const data = copy.prepare('SELECT data FROM app_state WHERE id = 1').get() as { data?: string } | undefined;
    if (typeof data?.data !== 'string') throw new Error('state_missing');
    const { state, counts } = cleanOrThrow(JSON.parse(data.data));
    if (!target) return counts;
    copy.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
    try {
      const written = copy.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(state));
      if (Number(written.changes) !== 1) throw new Error('state_missing');
      copy.exec('COMMIT');
    } catch (error) {
      copy.exec('ROLLBACK');
      throw error;
    }
    // Пересобрать копию, чтобы старые страницы не остались в файле.
    // Сами блоки носителя, WAL и прежние резервные копии это не стирает.
    copy.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM');
    copy.close();
    copy = undefined;
    verifySqliteSnapshot(temp);
    publishFile(temp, target);
    return counts;
  } finally {
    copy?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ----------------------------- PostgreSQL ---------------------------- */

/** Схема-копия: имя проверяем строго, чтобы не собрать SQL из ввода. */
function assertCopySchema(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(name) || name === 'gib' || name === 'public' || name.startsWith('pg_')) {
    throw new Error('invalid_copy_schema');
  }
  return name;
}

/**
 * PG не правится на месте: состояние копируется в отдельную схему той же базы,
 * очищается там и остаётся лежать рядом. Включить копию — решение владельца
 * (переименование схем), а не побочный эффект чистки.
 *
 * Копия пишется тем же `writeState`, что и рабочая схема, поэтому структура
 * не может разойтись: тот же код, те же колонки, тот же `data`.
 */
export function cleanPostgres(
  env: NodeJS.ProcessEnv,
  targetSchema?: string
): { counts: StoryQualityCleanupCounts; target?: string } {
  // Отдельный мост: CLI не делит соединение с приложением и закрывает своё.
  const bridge = openDetachedBridge(env);
  try {
    // Пустая база — не ошибка: миграцию могли запустить до первого старта.
    // Отвечаем понятно, а не «relation gib.profiles does not exist» из SQL.
    const ready = bridge.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'gib' AND table_name = 'sessions' LIMIT 1"
    ) as unknown[];
    if (!ready.length) {
      if (!targetSchema) return { counts: EMPTY_COUNTS };
      throw new Error('схема gib ещё не создана: запустите приложение хотя бы раз, затем повторите');
    }
    const state = readState(bridge) as unknown;
    const { state: cleaned, counts } = cleanOrThrow(state);
    if (!targetSchema) return { counts };

    const schema = assertCopySchema(targetSchema);
    bridge.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    for (const table of STATE_TABLES) {
      bridge.exec(`DROP TABLE IF EXISTS ${schema}.${table}`);
      bridge.exec(`CREATE TABLE ${schema}.${table} (LIKE gib.${table} INCLUDING ALL)`);
    }
    // Заселяем копию как есть, затем пишем очищенное состояние: writeState
    // сравнит и обновит только изменённые строки.
    const before = readState(bridge, schema);
    writeState(bridge, before, cleaned as never, schema);
    // Проверка: копия действительно без меток, а исходник не тронут.
    const after = readState(bridge, schema) as unknown;
    const recheck = cleanStoryQuality(after, { deferActive: false });
    if (recheck.counts.finishedLabelsRemoved + recheck.counts.activeLabelsRemoved +
        recheck.counts.activeSnapshotsRemoved + recheck.counts.receiptLabelsRemoved > 0) {
      throw new Error('copy_not_clean');
    }
    return { counts, target: `${schema} (та же база; включается переименованием схем)` };
  } finally {
    bridge.close();
  }
}

/* ------------------------------- CLI -------------------------------- */

function parseArgs(argv: string[]) {
  const [mode, ...rest] = argv;
  if (mode !== '--dry-run' && mode !== '--copy') throw new Error('usage');
  const postgres = rest.includes('--postgres');
  const args = rest.filter((value) => value !== '--postgres');
  if (postgres) {
    // --copy --postgres <schema> | --dry-run --postgres
    if (mode === '--copy' ? args.length !== 1 : args.length !== 0) throw new Error('usage');
    return { mode, postgres: true as const, source: undefined, target: args[0] };
  }
  if (mode === '--copy' ? args.length !== 2 : args.length !== 1) throw new Error('usage');
  return { mode, postgres: false as const, source: args[0], target: args[1] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let result: CleanupResult;
  if (args.postgres) {
    if (!process.env.GIB_PG_DIR && !process.env.GIB_POSTGRES_URL && !process.env.DATABASE_URL) {
      throw new Error('нужен GIB_PG_DIR или GIB_POSTGRES_URL');
    }
    const { counts, target } = cleanPostgres(process.env, args.mode === '--copy' ? args.target : undefined);
    result = { kind: 'postgres', mode: args.mode === '--copy' ? 'copy' : 'dry-run', counts, target };
  } else {
    const kind = detectSourceKind(args.source!);
    const target = args.mode === '--copy' ? path.resolve(args.target!) : undefined;
    if (target && path.resolve(args.source!) === target) throw new Error('нельзя писать поверх исходника');
    const counts = kind === 'json'
      ? cleanJson(args.source!, target)
      : await cleanSqlite(args.source!, target);
    result = { kind, mode: target ? 'copy' : 'dry-run', counts, target };
  }
  console.log(JSON.stringify(result, null, 2));
  console.log('Исходник не изменён. Копия отражает только момент снимка; перед включением остановите запись и проверьте резервную копию.');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'cleanup failed');
    process.exitCode = 1;
  });
}
