/**
 * Общее хранилище счётчиков лимита.
 *
 * Зачем: лимит «в памяти процесса» умножается на число инстансов. При двух
 * процессах разрешённые 240 запросов превращаются в 480, и это невидимо, пока
 * кто-то не начнёт этим пользоваться. Здесь счётчик живёт вне процесса.
 *
 * Реализации:
 *  - `memory` — по умолчанию и для тестов. Не распределённый; так и помечается
 *    в отчёте, чтобы это не выдавалось за кластерный лимит.
 *  - `sqlite` — на том же файле, что и состояние игры: одна маленькая таблица
 *    `rate_limits`, атомарный UPSERT внутри `BEGIN IMMEDIATE`. Годится для
 *    нескольких процессов на одной машине.
 *  - `postgres` — общий счётчик для нескольких машин: таблица `gib.rate_limits`
 *    в той же базе, что и состояние игры. Синхронность сохранена тем же мостом
 *    (`lib/postgres/bridge.ts`), что и у `store`: маршруты не переписывались на
 *    `async`. UPSERT и чтение идут одной командой `INSERT … ON CONFLICT …
 *    RETURNING`, поэтому два процесса не могут оба увидеть «осталось 1».
 *
 * Режим `postgres` без строки подключения **не** подменяется памятью молча:
 * он возвращает причину, и это видно в отчёте готовности.
 *
 * Хранилище сознательно не знает ничего о пользователе: ключ — уже готовый
 * хеш области и владельца (см. `clientKey`), значение — счётчик и время сброса.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDetachedBridge } from './postgres/state-backend.ts';
import type { PgBridge } from './postgres/bridge.ts';

export type Decision = { allowed: boolean; remaining: number; resetAt: number; limit: number };

export type LimitStoreKind = 'memory' | 'sqlite' | 'postgres';

export type LimitStore = {
  readonly kind: LimitStoreKind;
  /** true, только если счётчик реально общий для нескольких процессов. */
  readonly distributed: boolean;
  /** Атомарно увеличивает счётчик и говорит, можно ли пропустить запрос. */
  hit(key: string, limit: number, windowMs: number): Decision;
  /** Сбрасывает все истёкшие записи; вызывается периодически. */
  prune(now?: number): number;
  /** Сколько записей хранится — для метрик и тестов. */
  size(): number;
  close(): void;
};

/** Детерминированное время для тестов: без него окна не проверить. */
let clock: () => number = () => Date.now();
export function setLimitClock(fn: () => number): void { clock = fn; }

/**
 * Универсальная арифметика окна: одна и та же для всех реализаций.
 *
 * `count` — число запросов, **включая текущий**. Поэтому лимит 2 означает
 * ровно два разрешённых запроса, а третий отклоняется: проверка «count >= limit»
 * до увеличения отклоняла бы второй запрос и превращала лимит в «минус один».
 */
export function windowDecision(count: number, resetAt: number, limit: number, now: number): Decision {
  if (count > limit) return { allowed: false, remaining: 0, resetAt, limit };
  return { allowed: true, remaining: Math.max(0, limit - count), resetAt, limit };
}

export class MemoryLimitStore implements LimitStore {
  readonly kind = 'memory' as const;
  readonly distributed = false;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;

  constructor(maxKeys = 10_000) { this.maxKeys = maxKeys; }

  hit(key: string, limit: number, windowMs: number): Decision {
    const now = clock();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= this.maxKeys) {
        this.prune(now);
        if (this.buckets.size >= this.maxKeys) return { allowed: false, remaining: 0, resetAt: now + windowMs, limit };
      }
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return windowDecision(1, now + windowMs, limit, now);
    }
    if (bucket.count >= limit) return windowDecision(bucket.count + 1, bucket.resetAt, limit, now);
    bucket.count += 1;
    return windowDecision(bucket.count, bucket.resetAt, limit, now);
  }

  prune(now = clock()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) { this.buckets.delete(key); removed += 1; }
    }
    return removed;
  }

  size(): number { return this.buckets.size; }
  close(): void { this.buckets.clear(); }
}

/**
 * SQLite-хранилище счётчиков.
 *
 * Таблица отдельная от `app_state`: состояние игры не должно ждать лимитов и
 * наоборот. UPSERT и чтение внутри одной транзакции, поэтому два процесса не
 * могут оба увидеть «осталось 1».
 */
export class SqliteLimitStore implements LimitStore {
  readonly kind = 'sqlite' as const;
  readonly distributed = true;
  private readonly db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS rate_limits_reset ON rate_limits(reset_at)');
  }

  hit(key: string, limit: number, windowMs: number): Decision {
    const now = clock();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(key) as { count: number; reset_at: number } | undefined;
      let count: number;
      let resetAt: number;
      if (!row || row.reset_at <= now) {
        count = 1;
        resetAt = now + windowMs;
        this.db.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at').run(key, count, resetAt);
      } else if (row.count >= limit) {
        this.db.exec('COMMIT');
        return windowDecision(row.count + 1, row.reset_at, limit, now);
      } else {
        count = row.count + 1;
        resetAt = row.reset_at;
        this.db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').run(count, key);
      }
      this.db.exec('COMMIT');
      return windowDecision(count, resetAt, limit, now);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* транзакция могла не начаться */ }
      throw error;
    }
  }

  prune(now = clock()): number {
    const result = this.db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
    return Number(result.changes ?? 0);
  }

  size(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM rate_limits').get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  close(): void { this.db.close(); }
}

/**
 * PostgreSQL-хранилище счётчиков.
 *
 * Один оператор на весь шаг: `INSERT … ON CONFLICT … DO UPDATE … RETURNING`.
 * Считать и записывать двумя запросами нельзя — между ними влез бы второй
 * процесс. При истёкшем окне строка перезаписывается с новым `reset_at`.
 *
 * `count` в ответе — включая текущий запрос, поэтому сравнение идёт с `> limit`
 * (та же арифметика, что у памяти и SQLite: `windowDecision`).
 */
/**
 * Один оператор на весь шаг лимита. Вынесен в константу, чтобы тест проверял
 * на настоящем сервере именно тот SQL, который выполняется в приложении, а не
 * его копию.
 */
export const RATE_LIMIT_UPSERT = `INSERT INTO gib.rate_limits (bucket_key, count, reset_at) VALUES ($1, 1, $2)
       ON CONFLICT (bucket_key) DO UPDATE SET
         count = CASE WHEN gib.rate_limits.reset_at <= $3 THEN 1 ELSE gib.rate_limits.count + 1 END,
         reset_at = CASE WHEN gib.rate_limits.reset_at <= $3 THEN $2 ELSE gib.rate_limits.reset_at END
       RETURNING count, reset_at`;

export class PgLimitStore implements LimitStore {
  readonly kind = 'postgres' as const;
  readonly distributed = true;
  private readonly bridge: PgBridge;

  constructor(bridge: PgBridge) {
    this.bridge = bridge;
    // Схема могла быть создана до появления таблицы лимитов: создаём, если нет.
    this.bridge.exec('CREATE SCHEMA IF NOT EXISTS gib');
    this.bridge.exec('CREATE TABLE IF NOT EXISTS gib.rate_limits (bucket_key TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK (count >= 0), reset_at BIGINT NOT NULL CHECK (reset_at >= 0))');
    this.bridge.exec('CREATE INDEX IF NOT EXISTS rate_limits_reset ON gib.rate_limits(reset_at)');
  }

  hit(key: string, limit: number, windowMs: number): Decision {
    const now = clock();
    const resetAt = now + windowMs;
    // Окно истекло — начинаем заново; иначе увеличиваем счётчик.
    // `attempt` — счётчик попытки: при истёкшем окне он равен 1.
    const rows = this.bridge.query(RATE_LIMIT_UPSERT, [key, resetAt, now]);
    const row = rows[0];
    if (!row) throw new Error('rate limit upsert returned no row');
    return windowDecision(Number(row.count), Number(row.reset_at), limit, now);
  }

  prune(now = clock()): number {
    const rows = this.bridge.query('DELETE FROM gib.rate_limits WHERE reset_at <= $1 RETURNING bucket_key', [now]);
    return rows.length;
  }

  size(): number {
    const row = this.bridge.query('SELECT COUNT(*) AS n FROM gib.rate_limits')[0];
    return Number(row?.n ?? 0);
  }

  /** Соединение общее на процесс: закрывать его здесь нельзя. */
  close(): void { /* ничего не делает намеренно */ }
}

/** Выбор хранилища по окружению. Ничего не бросает: при сбое — память и метка. */
export type ResolvedLimitStore = { store: LimitStore; fallbackReason?: string };

export function resolveLimitStore(env: NodeJS.ProcessEnv = process.env): ResolvedLimitStore {
  const mode = (env.GIB_RATE_LIMIT_STORE ?? 'memory').toLowerCase();
  if (mode === 'memory') return { store: new MemoryLimitStore() };
  if (mode === 'sqlite') {
    try {
      const file = env.GIB_SQLITE_FILE || path.join(process.cwd(), 'data', 'gib.sqlite');
      return { store: new SqliteLimitStore(file) };
    } catch (error) {
      return { store: new MemoryLimitStore(), fallbackReason: `sqlite: ${(error as Error).message}` };
    }
  }
  if (mode === 'postgres') {
    // Без строки подключения честно говорим причину: молчаливая память
    // означала бы, что лимит умножается на число инстансов незаметно.
    if (!env.GIB_POSTGRES_URL && !env.DATABASE_URL && !env.GIB_PG_DIR) {
      return { store: new MemoryLimitStore(), fallbackReason: 'postgres: не задана строка подключения (GIB_POSTGRES_URL)' };
    }
    try {
      return { store: new PgLimitStore(openDetachedBridge(env)) };
    } catch (error) {
      return { store: new MemoryLimitStore(), fallbackReason: `postgres: ${(error as Error).message}` };
    }
  }
  return { store: new MemoryLimitStore(), fallbackReason: `unknown mode: ${mode}` };
}
