/**
 * Лимиты запросов в PostgreSQL: один счётчик для нескольких клиентов.
 *
 * Зачем отдельный тест. Лимит «в памяти процесса» умножается на число
 * инстансов: разрешённые 240 превращаются в 480, и это невидно, пока никто
 * не начнёт этим пользоваться. Встроенная PGlite в двух каталогах — это две
 * **разные** базы, поэтому общий счётчик ею не проверить. Здесь поднимается
 * сокет-сервер PGlite и к нему идут два независимых подключения: та же
 * картина, что у двух процессов на одной базе.
 *
 * Проверяется тот же SQL, что выполняет `PgLimitStore` в приложении: класс
 * ходит в базу через синхронный мост, а сетевой вызов синхронным не бывает,
 * поэтому здесь берётся его оператор и выполняется через `pg` дважды.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { RATE_LIMIT_UPSERT, resolveLimitStore, PgLimitStore } from '../lib/ratelimit-store.ts';
import { stopPgliteSocketServer } from './pglite-socket-shutdown.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-rl-pg-'));

/** Решение по окну — та же арифметика, что в приложении. */
function decide(count: number, resetAt: number, limit: number, now: number) {
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt, limit };
}

async function main(): Promise<void> {
  const db = new PGlite();
  // По умолчанию сервер пускает одно соединение: два пула дали бы EPIPE.
  // Нам нужны именно два одновременных клиента — это и есть модель двух процессов.
  const server = new PGLiteSocketServer({ db, path: path.join(dir, '.s.PGSQL.5432'), maxConnections: 4 });
  const url = `postgresql://test@localhost/test?host=${encodeURIComponent(dir)}`;
  await server.start();
  const pools: pg.Pool[] = [];
  const client = (): pg.Pool => { const p = new pg.Pool({ connectionString: url, ssl: false }); pools.push(p); return p; };
  const a = client();
  const b = client();
  const hit = async (pool: pg.Pool, key: string, limit: number, windowMs: number, now = Date.now()) => {
    const result = await pool.query(RATE_LIMIT_UPSERT, [key, now + windowMs, now]);
    const row = result.rows[0] as { count: number; reset_at: string | number };
    return decide(Number(row.count), Number(row.reset_at), limit, now);
  };
  try {
    await a.query('CREATE SCHEMA IF NOT EXISTS gib');
    await a.query(`CREATE TABLE IF NOT EXISTS gib.rate_limits (
      bucket_key TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK (count >= 0), reset_at BIGINT NOT NULL CHECK (reset_at >= 0))`);

    // 1. Общий счётчик: лимит 3 не даёт четвёртый запрос ни одному клиенту.
    const seq = [
      await hit(a, 'owner', 3, 60_000),
      await hit(b, 'owner', 3, 60_000),
      await hit(a, 'owner', 3, 60_000),
      await hit(b, 'owner', 3, 60_000),
    ];
    assert.deepEqual(seq.map(d => d.allowed), [true, true, true, false],
      'два клиента делят один лимит, четвёртый запрос отклонён');
    assert.equal(seq[3].remaining, 0);
    console.log('  ok два независимых подключения делят один счётчик (лимит 3 → 4-й отказ)');

    // 2. Разные ключи не мешают друг другу.
    assert.equal((await hit(a, 'neighbour', 1, 60_000)).allowed, true, 'соседний ключ не задет');
    assert.equal((await hit(a, 'neighbour', 1, 60_000)).allowed, false, 'свой лимит всё равно режет');
    console.log('  ok лимит одного ключа не задевает другой');

    // 3. Окно истекает: счётчик начинается заново.
    const base = 1_000_000;
    assert.equal((await hit(a, 'window', 2, 1000, base)).allowed, true);
    assert.equal((await hit(a, 'window', 2, 1000, base)).allowed, true);
    assert.equal((await hit(a, 'window', 2, 1000, base)).allowed, false, 'внутри окна третий отклонён');
    const after = await hit(a, 'window', 2, 1000, base + 1001);
    assert.equal(after.allowed, true, 'после окна счётчик начат заново');
    assert.equal(after.remaining, 1);
    console.log('  ok окно истекает и счётчик начинается заново');

    // 4. Новое подключение видит прежний счётчик, а не начинает с нуля.
    await hit(a, 'persist', 1, 60_000);
    assert.equal((await hit(b, 'persist', 1, 60_000)).allowed, false,
      'счётчик переживает переподключение');
    console.log('  ok счётчик переживает переподключение');

    // 5. Очистка удаляет истёкшие и только их: у 'window' окно кончилось,
    // у 'owner' и 'persist' — ещё нет. Граница берётся между ними.
    // reset_at объявлен BIGINT, и `pg` отдаёт его строкой: приведение делаем
    // в SQL, иначе сравнение «строка <= число» молча ничего не удалит.
    // Окно 'window' перезапускалось на base+1001 и истекает в base+2001:
    // граница берётся ровно на нём, живые окна (настоящее время) выше.
    const boundary = base + 2001;
    const removed = await a.query('DELETE FROM gib.rate_limits WHERE reset_at <= $1::bigint RETURNING bucket_key', [boundary]);
    const gone = (removed.rows as { bucket_key: string }[]).map(r => r.bucket_key);
    assert.deepEqual(gone, ['window'], `удалены только истёкшие, а удалены: ${gone.join(',') || 'ничего'}`);
    const left = await a.query("SELECT COUNT(*)::int AS n FROM gib.rate_limits WHERE bucket_key = 'owner'");
    assert.equal(left.rows[0].n, 1, 'живое окно осталось');
    console.log('  ok очистка удаляет истёкшие и только их');

    // 6. Режим postgres без подключения не подменяется памятью молча.
    //
    // Почему здесь не проверяется успешное включение. Синхронный мост
    // (`lib/postgres/bridge.ts`) блокирует поток на `Atomics.wait`, пока база
    // отвечает. В этом тесте сервер PGlite живёт в том же процессе, поэтому
    // мост ждёт ответа, который сам же и не может отдать, — получится таймаут.
    // Успешное включение проверяется отдельно, процессом с настоящим
    // PostgreSQL (`npm run test:postgres-live`), где база в другом процессе.
    const refused = resolveLimitStore({ GIB_RATE_LIMIT_STORE: 'postgres' } as unknown as NodeJS.ProcessEnv);
    assert.equal(refused.store.kind, 'memory', 'без строки подключения — память');
    assert.ok(refused.fallbackReason?.includes('postgres'), 'но причина названа, а не скрыта');
    assert.equal(typeof PgLimitStore, 'function', 'класс лимитов экспортируется');
    console.log('  ok режим postgres без подключения не подменяется молча');
  } finally {
    await Promise.all(pools.map(p => p.end()));
    await stopPgliteSocketServer(server, db);
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('\nЛимиты в PostgreSQL: общий счётчик, окна и переподключение.');
}

main().catch(error => { console.error(error); process.exit(1); });
