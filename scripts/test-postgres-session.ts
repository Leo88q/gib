/** Exercises the existing game engine against an isolated PostgreSQL-compatible engine. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, answerOwnedSession } from '../lib/postgres/session-repository';
import type { AnswerPayload } from '../lib/engine/session';

function check(v: unknown, label: string): asserts v { if (!v) throw Error(label); console.log('  ok', label); }
async function main() {
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-session-'));
const dbPath = path.join(dir, 'database');
let db = await PGlite.create(dbPath);
let client: SqlClient = { query: async (sql, params) => db.query(sql, params) };
const all = async () => Object.fromEntries(await Promise.all(['skills', 'program_states', 'player_states', 'sessions'].map(async table => [table, (await client.query(`SELECT data FROM gib.${table} ORDER BY ordinal`)).rows])));
try {
  await ensureSchema(client);
  await importLegacy(client, { profiles: [
    { id: 'p6', parentId: 'a6', name: 'Тест', age: 6, band: '5-7', createdAt: 1 },
    { id: 'p9', parentId: 'a9', name: 'Тест', age: 9, band: '8-10', createdAt: 1 },
    { id: 'p12', parentId: 'a12', name: 'Тест', age: 12, band: '11-13', createdAt: 1 },
  ], sessions: [] });
  check('error' in await startOwnedSession(client, 'a9', 'p6'), 'чужой профиль не открывает сессию');
  for (const [parent, id] of [['a6', 'p6'], ['a9', 'p9'], ['a12', 'p12']]) {
    const start = await startOwnedSession(client, parent, id);
    check(!('error' in start) && start.step === 0 && !start.resumed, `миссия создана для ${id}`);
    if ('error' in start) throw Error('start');
    check(!JSON.stringify(start.item).includes('"answer"'), 'публичное задание не содержит ключ');
    check('error' in await answerOwnedSession(client, 'other', start.sessionId, {}, 100, 0), 'другому родителю сессия недоступна');
    let step = 0; let done = false; let last: { payload: AnswerPayload; step: number; result: unknown } | null = null;
    while (!done) {
      const row = await client.query('SELECT data FROM gib.sessions WHERE id=$1', [start.sessionId]);
      const session = row.rows[0].data as any;
      const item = session.runtime.items[step];
      const payload: AnswerPayload = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
      const beforeAnswerSkill = step === 1 && id === 'p9' && item.type === 'task' ? (await client.query('SELECT data FROM gib.skills WHERE profile_id=$1 AND skill=$2', [id, item.instance.skill])).rows[0]?.data : null;
      if (step === 0) {
        const beforeInvalid = JSON.stringify(await all());
        const invalid = await answerOwnedSession(client, parent, start.sessionId, {}, 250, step);
        check('error' in invalid && invalid.error === 'invalid_answer' && JSON.stringify(await all()) === beforeInvalid, 'неверный ответ не изменяет состояние');
        const stale = await answerOwnedSession(client, parent, start.sessionId, payload, 250, step + 1);
        check('error' in stale && stale.error === 'step_conflict' && JSON.stringify(await all()) === beforeInvalid, 'неверный номер шага не изменяет состояние');
      }
      if (step === 0 && id === 'p6') {
        const before = JSON.stringify(await all());
        let failed = false;
        const failing: SqlClient = { query: async (sql, params) => { if (sql.startsWith('UPDATE gib.sessions')) throw Error('injected'); return client.query(sql, params); } };
        try { await answerOwnedSession(failing, parent, start.sessionId, payload, 250, step); } catch { failed = true; }
        check(failed && JSON.stringify(await all()) === before, 'ошибка после записи навыка и наград полностью откатывает шаг');
      }
      const result = await answerOwnedSession(client, parent, start.sessionId, payload, 250, step);
      check(!('error' in result), 'ответ и награды сохранены одной транзакцией');
      if ('error' in result) throw Error(String(result.error));
      if (beforeAnswerSkill) {
        const skillAfter = (await client.query('SELECT data FROM gib.skills WHERE profile_id=$1 AND skill=$2', [id, item.instance.skill])).rows[0]?.data;
        check(isDeepStrictEqual(beforeAnswerSkill, skillAfter) && result.feedback.includes('сложность навыка не меняется'), 'возобновлённый шаг — практика, навык не изменён');
      }
      const after = JSON.stringify(await all());
      const retry = await answerOwnedSession(client, parent, start.sessionId, payload, 250, step);
      check(isDeepStrictEqual(JSON.parse(JSON.stringify(retry)), JSON.parse(JSON.stringify(result))) && JSON.stringify(await all()) === after, 'повтор возвращает квитанцию без повторного начисления');
      const changed = await answerOwnedSession(client, parent, start.sessionId, { ...payload, assisted: true }, 250, step);
      check('error' in changed && changed.error === 'step_conflict', 'изменённый повтор отклонён');
      done = result.done; last = { payload, step, result }; step++;
      if (step === 1 && !done && id === 'p9') {
        const resume = await startOwnedSession(client, parent, id);
        check(!('error' in resume) && resume.resumed && resume.step === step && resume.sessionId === start.sessionId, 'прерванная миссия восстановлена с текущим шагом');
        const restored = (await client.query('SELECT data FROM gib.sessions WHERE id=$1', [start.sessionId])).rows[0].data as any;
        check(restored.runtime.practiceSteps.includes(step), 'признак практики сохранён в PostgreSQL');
      }
    }
    const program = await client.query('SELECT data FROM gib.program_states WHERE profile_id=$1', [id]);
    const player = await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', [id]);
    check((program.rows[0].data as any).completedDays === 1 && (player.rows[0].data as any).stats.days === 1, 'прохождение и статистика завершения записаны один раз');
    if (id === 'p12' && last) {
      await db.close(); db = await PGlite.create(dbPath); client = { query: async (sql, params) => db.query(sql, params) };
      const beforeRetry = JSON.stringify(await all());
      const retry = await answerOwnedSession(client, parent, start.sessionId, last.payload, 250, last.step);
      check(isDeepStrictEqual(JSON.parse(JSON.stringify(retry)), JSON.parse(JSON.stringify(last.result))) && JSON.stringify(await all()) === beforeRetry, 'после перезапуска повтор финала не начисляет награду');
    }
  }
} finally { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
