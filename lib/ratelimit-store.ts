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
 *  - PostgreSQL для нескольких машин **не реализован**: интерфейс маршрутов
 *    синхронный, а сетевой вызов синхронным не бывает. Поэтому режим
 *    `postgres` не подменяется памятью молча — он возвращает причину, и это
 *    видно в отчёте готовности. Делать его нужно вместе с асинхронными
 *    маршрутами (тот же переход, что и перенос на PostgreSQL).
 *
 * Хранилище сознательно не знает ничего о пользователе: ключ — уже готовый
 * хеш области и владельца (см. `clientKey`), значение — счётчик и время сброса.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Decision = { allowed: boolean; remaining: number; resetAt: number; limit: number };

export type LimitStoreKind = 'memory' | 'sqlite';

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
    // Синхронный интерфейс маршрутов не ждёт сети: честно сообщаем, что
    // кластерный лимит не включён, вместо тихой подмены на память.
    return { store: new MemoryLimitStore(), fallbackReason: 'postgres: требует асинхронного слоя, не включён' };
  }
  return { store: new MemoryLimitStore(), fallbackReason: `unknown mode: ${mode}` };
}
