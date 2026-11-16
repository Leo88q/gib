/** Socket-level test of pg client + PGlite; not a multi-process PostgreSQL server test. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { isDeepStrictEqual } from 'node:util';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, answerOwnedSession } from '../lib/postgres/session-repository';
import { shutdownPgliteSocketServer } from './pglite-socket-shutdown.ts';
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-wire-'));
  const db = new PGlite(); let server = new PGLiteSocketServer({ db, path: path.join(dir, '.s.PGSQL.5432') });
  const url = `postgresql://test@localhost/test?host=${encodeURIComponent(dir)}`;
  let pool: pg.Pool | undefined; let connection: pg.PoolClient | undefined;
  const connect = async (): Promise<SqlClient> => { pool = new pg.Pool({ connectionString: url, ssl: false }); connection = await pool.connect(); return { query: async (sql, values) => connection!.query(sql, values) }; };
  const close = async () => { connection?.release(); connection = undefined; await pool?.end(); pool = undefined; };
  const check = (v: unknown, label: string): void => { if (!v) throw Error(label); console.log('  ok', label); };
  try {
    await server.start(); let client = await connect();
    await ensureSchema(client);
    await importLegacy(client, { profiles: [{ id: 'p1', parentId: 'parent', name: 'Тест', age: 8, band: '8-10', createdAt: 1 }], sessions: [] });
    const start = await startOwnedSession(client, 'parent', 'p1');
    if ('error' in start) throw Error('failed to start');
    const session = (await client.query('SELECT data FROM gib.sessions WHERE id=$1', [start.sessionId])).rows[0].data as any;
    const item = session.runtime.items[0]; const payload = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
    const result = await answerOwnedSession(client, 'parent', start.sessionId, payload, 500, 0);
    check(!('error' in result), 'pg-клиент: ответ и награда сохранены');
    await close(); await server.stop();
    server = new PGLiteSocketServer({ db, path: path.join(dir, '.s.PGSQL.5432') });
    await server.start(); client = await connect();
    const retry = await answerOwnedSession(client, 'parent', start.sessionId, payload, 500, 0);
    check(isDeepStrictEqual(JSON.parse(JSON.stringify(retry)), JSON.parse(JSON.stringify(result))), 'новое подключение: повтор возвращает ту же квитанцию');
    const unauthorized = await answerOwnedSession(client, 'stranger', start.sessionId, payload, 500, 0);
    check('error' in unauthorized && unauthorized.error === 'session_not_found', 'pg-клиент: чужая сессия недоступна');
  } finally { await close(); await shutdownPgliteSocketServer(server, db); fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
