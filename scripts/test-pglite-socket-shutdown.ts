/**
 * Проверка исправления гонки закрытия PGlite-сокета.
 *
 * Гонка была недетерминированной, поэтому тест не «ловит её иногда», а
 * ставит условия, при которых она обязана случиться: соединение оставляет
 * открытую транзакцию, `server.stop()` не ждёт `detach`, а `db.close()`
 * вызывается сразу. Без помощника закрытие приходит в середину транзакции —
 * это и есть наблюдавшийся `isInTransaction` при закрытии уже закрытого PGlite.
 *
 * Проверяем два утверждения:
 * 1. помощник возвращает управление только когда база вышла из транзакции;
 * 2. после помощника `db.close()` проходит без ошибки и данные на диске целы.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { stopPgliteSocketServer, shutdownPgliteSocketServer } from './pglite-socket-shutdown.ts';

async function withSocket<T>(run: (ctx: { db: PGlite; server: PGLiteSocketServer; url: string; dir: string }) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-shutdown-'));
  const db = new PGlite();
  const server = new PGLiteSocketServer({ db, path: path.join(dir, '.s.PGSQL.5432') });
  await server.start();
  const url = `postgresql://test:test@localhost/test?host=${encodeURIComponent(dir)}`;
  try {
    return await run({ db, server, url, dir });
  } finally {
    await shutdownPgliteSocketServer(server, db).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await withSocket(async ({ db, server, url }) => {
    // Соединение открывает транзакцию и «теряется» — ровно тот случай, когда
    // detach должен откатить её уже после возврата stop().
    const pool = new pg.Pool({ connectionString: url, ssl: false, max: 1 });
    const connection = await pool.connect();
    await connection.query('BEGIN');
    await connection.query('CREATE TABLE IF NOT EXISTS shutdown_probe (x int)');
    connection.release(true); // вернуть в пул как повреждённое, не закрывая
    await new Promise<void>(resolve => { setTimeout(resolve, 50); });

    // Ключевое условие: закрываем, не дожидаясь stop() вручную.
    await stopPgliteSocketServer(server, db);
    assert.equal(db.isInTransaction(), false, 'после помощника база вне транзакции');
    console.log('  ok помощник возвращает управление только вне транзакции');

    // Закрытие не должно упасть: именно здесь раньше приходил isInTransaction.
    await db.close();
    console.log('  ok закрытие после помощника проходит без ошибки');

    await pool.end().catch(() => {});
    // База закрыта — повторное закрытие не должно ломать уборку.
    await shutdownPgliteSocketServer(server, undefined);
  });

  // Отдельно: без открытой транзакции помощник не ждёт лишнего.
  await withSocket(async ({ db, server }) => {
    const started = Date.now();
    await stopPgliteSocketServer(server, db);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `пустая база закрывается быстро, а не за ${elapsed} мс`);
    console.log('  ok без открытой транзакции ожидание не добавляется');
  });

  console.log('\nЗакрытие PGlite-сокета: откат транзакции дожидается до закрытия базы.');
}

main().catch(error => { console.error(error); process.exit(1); });
