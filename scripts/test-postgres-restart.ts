/** Two phases with a real, isolated LOCAL PostgreSQL restart between them. Synthetic data only. */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, answerOwnedSession } from '../lib/postgres/session-repository';
import type { AnswerPayload } from '../lib/engine/session';
async function main() {
  const raw = process.env.GIB_POSTGRES_TEST_URL;
  const marker = process.env.GIB_PG_RESTART_MARKER ?? 'data/pg-restart-test.json';
  if (!raw || process.env.GIB_POSTGRES_DESTRUCTIVE_LOCAL_TEST !== '1' || !['prepare', 'resume'].includes(process.argv[2])) throw Error('Local test URL, acknowledgment and prepare/resume required');
  const parsed = new URL(raw); const host = parsed.searchParams.get('host') || parsed.hostname;
  if (!host.startsWith('/') && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) throw Error('Only an isolated local server is allowed');
  const admin = new pg.Client({ connectionString: raw, ssl: false }); await admin.connect();
  let pool: pg.Pool | undefined; let connection: pg.PoolClient | undefined;
  const close = async () => { connection?.release(); connection = undefined; await pool?.end(); pool = undefined; };
  const check = (v: unknown, msg: string): void => { if (!v) throw Error(msg); console.log('  ok', msg); };
  try {
    let name: string;
    if (process.argv[2] === 'prepare') {
      if (fs.existsSync(marker)) throw Error('Marker already exists');
      name = `gib_restart_${randomBytes(8).toString('hex')}`;
      await admin.query(`CREATE DATABASE "${name}"`);
    } else {
      name = JSON.parse(fs.readFileSync(marker, 'utf8')).database;
      if (!/^gib_restart_[a-f0-9]{16}$/.test(name)) throw Error('Invalid test database marker');
    }
    parsed.pathname = `/${name}`; pool = new pg.Pool({ connectionString: parsed.toString(), ssl: false }); connection = await pool.connect();
    const client: SqlClient = { query: async (sql, values) => connection!.query(sql, values) };
    if (process.argv[2] === 'prepare') {
      await ensureSchema(client); await importLegacy(client, { profiles: [{ id: 'p', parentId: 'parent', name: 'Тест', age: 9, band: '8-10', createdAt: 1 }], sessions: [] });
      const start = await startOwnedSession(client, 'parent', 'p'); if ('error' in start) throw Error('start failed');
      let step = 0; let last: { payload: AnswerPayload; result: unknown; step: number } | null = null;
      while (true) {
        const state = (await client.query('SELECT data FROM gib.sessions WHERE id=$1', [start.sessionId])).rows[0].data as any;
        const item = state.runtime.items[step]; const payload: AnswerPayload = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
        const result = await answerOwnedSession(client, 'parent', start.sessionId, payload, 200, step);
        if ('error' in result) throw Error('answer failed');
        if (result.done) { last = { payload, result, step }; break; } step++;
      }
      const player = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data;
      fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
      fs.writeFileSync(marker, JSON.stringify({ database: name, sessionId: start.sessionId, last, player }), { flag: 'wx', mode: 0o600 });
      check(true, 'миссия завершена, финальная квитанция подготовлена для проверки после перезапуска');
    } else {
      const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const before = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data;
      const retry = await answerOwnedSession(client, 'parent', saved.sessionId, saved.last.payload, 200, saved.last.step);
      const after = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data;
      check(isDeepStrictEqual(JSON.parse(JSON.stringify(retry)), saved.last.result), 'после перезапуска PostgreSQL финальная квитанция сохранена');
      check(isDeepStrictEqual(before, after) && isDeepStrictEqual(after, saved.player), 'повтор после перезапуска не меняет награды и статистику');
      await close(); await admin.query(`DROP DATABASE "${name}"`); fs.unlinkSync(marker);
      check(true, 'временная тестовая база и маркер удалены');
    }
  } finally { await close(); await admin.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
