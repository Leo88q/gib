/**
 * Поток базы: здесь живёт настоящее соединение PostgreSQL.
 *
 * Обмен с главным потоком — через общую память (`SharedArrayBuffer`) и
 * `Atomics`: главный поток ждёт, воркер пишет ответ. Это единственный способ
 * дать синхронный интерфейс поверх сетевого клиента без изменения всего кода
 * игры.
 *
 * Два режима:
 *  - `PG_URL` / `DATABASE_URL` задана — `pg` (настоящий сервер);
 *  - не задана — встроенный PGlite (тот же SQL в отдельном процессе).
 *
 * Чего здесь нет: пула соединений и асинхронной параллельности. Один запрос в
 * один момент — это ограничение честно записано в регламенте.
 */
import { parentPort, workerData } from 'node:worker_threads';

const control = new Int32Array(workerData.sab, 0, 4);
const body = new Uint8Array(workerData.sab, 16);
const encoder = new TextEncoder();

let db = null;
let mode = 'pglite';

function reply(state, text) {
  const bytes = encoder.encode(text);
  body.set(bytes.subarray(0, body.length));
  Atomics.store(control, 1, Math.min(bytes.length, body.length));
  Atomics.store(control, 0, state);
  Atomics.notify(control, 0);
}

async function open() {
  if (workerData.connectionString) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: workerData.connectionString });
    await client.connect();
    mode = 'postgres';
    db = {
      query: (sql, params) => client.query(sql, params),
      exec: sql => client.query(sql),
      close: () => client.end(),
    };
    return;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const instance = await PGlite.create(workerData.dataDir);
  mode = 'pglite';
  db = {
    query: (sql, params) => instance.query(sql, params),
    exec: sql => instance.exec(sql),
    close: async () => instance.close(),
  };
}

parentPort.on('message', async message => {
  try {
    if (!db) await open();
    if (message.kind === 'info') {
      reply(1, JSON.stringify([{ mode, server: mode === 'postgres' ? 'pg' : 'pglite' }]));
      return;
    }
    if (message.kind === 'ping') {
      await db.query('SELECT 1', []);
      reply(1, '[]');
      return;
    }
    if (message.kind === 'close') {
      await db.close();
      reply(1, '[]');
      return;
    }
    if (message.kind === 'exec') {
      await db.exec(message.sql);
      reply(1, '[]');
      return;
    }
    const result = await db.query(message.sql, message.params ?? []);
    reply(1, JSON.stringify(result.rows ?? []));
  } catch (error) {
    // Текст ошибки важнее стека: он говорит, что именно не так с SQL.
    reply(2, String(error && error.message ? error.message : error));
  }
});
