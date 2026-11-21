/**
 * Асинхронный пул соединений PostgreSQL (`pg.Pool`) для конкурентных нагрузок.
 *
 * Зачем отдельный пул рядом с синхронным мостом (`lib/postgres/bridge.ts`):
 *  - Игровое ядро (`store`) остаётся синхронным с сериализацией пишущих
 *    транзакций под `pg_advisory_xact_lock`, что гарантирует детерминизм 252
 *    тестов и отсутствие гонок при начислении наград.
 *  - Тяжёлые аналитические выборки (`/api/admin/overview`, `/api/admin/export`,
 *    `/api/admin/research`), проверка живости пула и фоновые рассылки при
 *    тысячах семей не должны блокировать `SharedArrayBuffer` игрового цикла —
 *    они идут напрямую через неблокирующий `pg.Pool`.
 *
 * В режимах PGlite (`GIB_PG_DIR` без `GIB_POSTGRES_URL`), SQLite и JSON пул
 * возвращает `null`, и вызывающий код прозрачно переключается на `store`.
 */
import pg from 'pg';
import { storeModeOf } from '../store-mode.ts';

let sharedPool: pg.Pool | null = null;
let sharedUrl: string | null = null;

export function resolvePostgresUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (storeModeOf(env) !== 'postgres') return null;
  const raw = (env.GIB_POSTGRES_URL ?? env.DATABASE_URL ?? '').trim();
  if (!/^postgres(?:ql)?:\/\//i.test(raw)) return null;
  return raw;
}

export function hasAsyncPostgresUrl(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolvePostgresUrl(env) !== null;
}

export function getAsyncPool(env: NodeJS.ProcessEnv = process.env): pg.Pool | null {
  const url = resolvePostgresUrl(env);
  if (!url) return null;
  if (sharedPool && sharedUrl === url) return sharedPool;
  if (sharedPool) {
    void sharedPool.end().catch(() => {});
    sharedPool = null;
  }
  const maxRaw = Number(env.GIB_PG_POOL_MAX ?? 20);
  const max = Number.isFinite(maxRaw) ? Math.max(2, Math.min(100, Math.trunc(maxRaw))) : 20;
  sharedPool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  sharedPool.on('error', () => {
    // Фоновые обрывы idle-клиентов обрабатываются пулом при следующем checkout.
  });
  sharedUrl = url;
  return sharedPool;
}

export async function closeAsyncPool(): Promise<void> {
  if (!sharedPool) return;
  const current = sharedPool;
  sharedPool = null;
  sharedUrl = null;
  await current.end();
}

export async function pingAsyncPool(env: NodeJS.ProcessEnv = process.env): Promise<{
  enabled: boolean;
  ok: boolean;
  latencyMs: number;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}> {
  const pool = getAsyncPool(env);
  if (!pool) {
    return { enabled: false, ok: true, latencyMs: 0, totalCount: 0, idleCount: 0, waitingCount: 0 };
  }
  const started = process.hrtime.bigint();
  try {
    await pool.query('SELECT 1');
    const latencyMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 100) / 100;
    return {
      enabled: true,
      ok: true,
      latencyMs,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  } catch {
    const latencyMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 100) / 100;
    return {
      enabled: true,
      ok: false,
      latencyMs,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }
}

export async function withAsyncClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const pool = getAsyncPool(env);
  if (!pool) throw new Error('Async PostgreSQL pool is not configured');
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withAsyncTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  return withAsyncClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }, env);
}

export type AsyncQueryable = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

/**
 * Неблокирующая выгрузка коллекций для аналитики и исследовательского экспорта
 * напрямую через `pg.Pool` (или инжектированный `AsyncQueryable`) в едином
 * `REPEATABLE READ READ ONLY` снимке.
 */
export async function readAnalyticsSnapshotAsync(
  env: NodeJS.ProcessEnv = process.env,
  customClient?: AsyncQueryable,
): Promise<{
  profiles: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  subs: Record<string, unknown>[];
  programStates: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  memberships: Record<string, unknown>[];
  ledgerCount: number;
  researchCodingsCount: number;
} | null> {
  const runOn = async (client: AsyncQueryable) => {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const hasTable = async (name: string) => {
        const r = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_schema = 'gib' AND table_name = $1",
          [name],
        );
        return (r.rowCount ?? r.rows.length) > 0;
      };
      const fetchData = async (table: string) => {
        if (!(await hasTable(table))) return [];
        const res = await client.query<{ data: Record<string, unknown> }>(
          `SELECT data FROM gib.${table} ORDER BY ordinal ASC`,
        );
        return res.rows.map((r) => r.data);
      };
      const profiles = await fetchData('profiles');
      const sessions = await fetchData('sessions');
      const subs = await fetchData('subscriptions');
      const programStates = await fetchData('program_states');
      const payments = await fetchData('payments');
      const groups = await fetchData('groups');
      const memberships = await fetchData('memberships');

      let ledgerCount = 0;
      if (await hasTable('payment_ledger')) {
        const lr = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM gib.payment_ledger');
        ledgerCount = Number(lr.rows[0]?.count ?? 0);
      }
      let researchCodingsCount = 0;
      if (await hasTable('research_codings')) {
        const rr = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM gib.research_codings');
        researchCodingsCount = Number(rr.rows[0]?.count ?? 0);
      }
      await client.query('COMMIT');
      return {
        profiles,
        sessions,
        subs,
        programStates,
        payments,
        groups,
        memberships,
        ledgerCount,
        researchCodingsCount,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  };

  if (customClient) return runOn(customClient);
  const pool = getAsyncPool(env);
  if (!pool) return null;
  return withAsyncClient((client) => runOn(client as unknown as AsyncQueryable), env);
}
