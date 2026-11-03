/** Destructive integration test: creates/drops a uniquely named database on an isolated LOCAL PostgreSQL instance only. */
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, answerOwnedSession } from '../lib/postgres/session-repository';
import type { AnswerPayload } from '../lib/engine/session';
import { actOnOwnedPlayer } from '../lib/postgres/player-repository';
async function main() {
  const raw = process.env.GIB_POSTGRES_TEST_URL;
  if (!raw || process.env.GIB_POSTGRES_DESTRUCTIVE_LOCAL_TEST !== '1') throw Error('Isolated local PostgreSQL test and explicit acknowledgement are required');
  const parsed = new URL(raw); const host = parsed.searchParams.get('host') || parsed.hostname;
  if (!host.startsWith('/') && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) throw Error('Only isolated local test servers are allowed');
  const database = `gib_test_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: raw, ssl: false }); await admin.connect();
  let pool: pg.Pool | undefined;
  const check = (v: unknown, text: string): void => { if (!v) throw Error(text); console.log('  ok', text); };
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    parsed.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: parsed.toString(), ssl: false, max: 16 });
    const withClient = async <T>(fn: (client: SqlClient) => Promise<T>): Promise<T> => {
      const conn = await pool!.connect();
      try { return await fn({ query: async (sql, values) => conn.query(sql, values) }); }
      finally { conn.release(); }
    };
    await withClient(async client => {
      await ensureSchema(client);
      await importLegacy(client, { profiles: [6, 8, 9, 12].map((age, i) => ({ id: `p${i}`, parentId: `parent${i}`, age, band: age < 8 ? '5-7' : age < 11 ? '8-10' : '11-13', name: 'Тест', createdAt: 1 })), sessions: [] });
    });
    const starts = await Promise.all(Array.from({ length: 6 }, () => withClient(client => startOwnedSession(client, 'parent0', 'p0'))));
    const created = starts.filter(s => !('error' in s) && !s.resumed);
    check(created.length === 1 && starts.every(s => !('error' in s) && s.sessionId === (created[0] as any).sessionId), '6 параллельных стартов одного профиля дают одну сессию');
    const sessionId = (created[0] as any).sessionId as string;
    const data = (await pool.query('SELECT data FROM gib.sessions WHERE id=$1', [sessionId])).rows[0].data;
    const first = data.runtime.items[0]; const firstAnswer: AnswerPayload = first.type === 'scenario' ? { index: 0 } : first.instance.answer;
    const replies = await Promise.all(Array.from({ length: 8 }, () => withClient(client => answerOwnedSession(client, 'parent0', sessionId, firstAnswer, 300, 0))));
    const normal = (v: unknown) => JSON.parse(JSON.stringify(v));
    check(replies.every(r => !('error' in r) && isDeepStrictEqual(normal(r), normal(replies[0]))), '8 параллельных повторов получают одну квитанцию');
    const player = (await pool.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p0'])).rows[0].data;
    const saved = (await pool.query('SELECT data FROM gib.sessions WHERE id=$1', [sessionId])).rows[0].data;
    check(saved.runtime.index === 1 && player.stats.tasks === 1, 'шаг, счётчик и награды применены один раз');
    const item = saved.runtime.items[1]; const payload: AnswerPayload = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
    const distinct = await Promise.all([payload, { ...payload, assisted: true }].map(value => withClient(client => answerOwnedSession(client, 'parent0', sessionId, value, 100, 1))));
    check(distinct.filter(r => !('error' in r)).length === 1 && distinct.filter(r => 'error' in r && r.error === 'step_conflict').length === 1, 'конкурирующие разные ответы не начисляются дважды');
    const newStarts = await Promise.all([1, 2, 3].map(i => withClient(client => startOwnedSession(client, `parent${i}`, `p${i}`))));
    check(newStarts.every(v => !('error' in v)), 'разные профили одновременно создают сессии и навыки без коллизии ordinal');
    const counts = await pool.query('SELECT (SELECT count(*) FROM gib.skills) AS skills, (SELECT count(*) FROM gib.sessions) AS sessions');
    check(Number(counts.rows[0].skills) === 24 && Number(counts.rows[0].sessions) === 4, 'созданы все навыки и сессии без потери данных');
    // Prepare only this isolated test profile to exercise competing writers.
    const fixturePlayer = (await pool.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p3'])).rows[0].data;
    fixturePlayer.coins = 100; fixturePlayer.missions.ids = ['warmup']; fixturePlayer.missions.progress = { warmup: 3 }; fixturePlayer.missions.claimed = [];
    await pool.query('UPDATE gib.player_states SET data=$1::jsonb WHERE profile_id=$2', [JSON.stringify(fixturePlayer), 'p3']);
    const competing = await Promise.all([
      ...Array.from({ length: 6 }, () => withClient(c => actOnOwnedPlayer(c, 'parent3', 'p3', 'buy', 'head_cap'))),
      ...Array.from({ length: 6 }, () => withClient(c => actOnOwnedPlayer(c, 'parent3', 'p3', 'claim', 'warmup'))),
    ]);
    const postActions = (await pool.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p3'])).rows[0].data;
    check(competing.filter(r => !('error' in r)).length === 2 && postActions.coins === 75 && postActions.inventory.filter((id: string) => id === 'head_cap').length === 1 && postActions.missions.claimed.filter((id: string) => id === 'warmup').length === 1, 'параллельные покупки и получение миссии списывают и начисляют только один раз');
    const session3Id = (newStarts[2] as any).sessionId;
    const session3 = (await pool.query('SELECT data FROM gib.sessions WHERE id=$1', [session3Id])).rows[0].data;
    const task3 = session3.runtime.items[0];
    const answer3: AnswerPayload = task3.type === 'scenario' ? { index: 0 } : task3.instance.answer;
    const [answerResult, purchaseResult] = await Promise.all([
      withClient(c => answerOwnedSession(c, 'parent3', session3Id, answer3, 100, 0)),
      withClient(c => actOnOwnedPlayer(c, 'parent3', 'p3', 'buy', 'body_scarf')),
    ]);
    const postMixed = (await pool.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p3'])).rows[0].data;
    check(!('error' in answerResult) && !('error' in purchaseResult) && postMixed.coins === 75 - 30 + answerResult.reward.coins && postMixed.inventory.includes('body_scarf') && postMixed.stats.tasks === 1, 'ответ и покупка одновременно сохраняют обе операции');
    const snapshot = async () => (await pool!.query('SELECT (SELECT jsonb_agg(data ORDER BY ordinal) FROM gib.sessions) AS sessions, (SELECT jsonb_agg(data ORDER BY ordinal) FROM gib.skills) AS skills, (SELECT jsonb_agg(data ORDER BY ordinal) FROM gib.player_states) AS players')).rows[0];
    const before = await snapshot();
    const current = (await pool.query('SELECT data FROM gib.sessions WHERE id=$1', [sessionId])).rows[0].data;
    const step = current.runtime.index; const currentItem = current.runtime.items[step];
    const currentAnswer: AnswerPayload = currentItem.type === 'scenario' ? { index: 0 } : currentItem.instance.answer;
    let failed = false;
    try { await withClient(async client => {
      const failing: SqlClient = { query: async (sql, args) => { if (sql.startsWith('UPDATE gib.sessions')) throw Error('test failure'); return client.query(sql, args); } };
      return answerOwnedSession(failing, 'parent0', sessionId, currentAnswer, 100, step);
    }); } catch { failed = true; }
    check(failed && isDeepStrictEqual(await snapshot(), before), 'сбой после промежуточных записей полностью откатывает сессию и награды');
    const wrong = await withClient(client => answerOwnedSession(client, 'parent1', sessionId, currentAnswer, 100, step));
    check('error' in wrong && wrong.error === 'session_not_found', 'проверка владельца не раскрывает чужую сессию');
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
