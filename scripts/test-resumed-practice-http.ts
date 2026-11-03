/** Two phases, isolated demo SQLite; restart the server between phases. */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3024';
const marker = process.env.MARKER ?? 'data/resumed-practice-marker.json';
const file = process.env.GIB_SQLITE_FILE ?? 'data/resumed-practice-test.sqlite';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'resumed-practice-test' };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); console.log('  ok', message); }
let db: DatabaseSync;
const state = () => JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
if (process.argv[2] === 'prepare') {
  const profile = await post('/api/profile', { name: 'Тест', age: 8 });
  check(profile.status === 200, 'создан профиль');
  db = new DatabaseSync(file, { readOnly: true });
  const profileId = profile.data.profile.id;
  const start = await post('/api/session', { action: 'start', profileId });
  check(start.status === 200 && start.data.item.type === 'task' && !['memory', 'symbol-memory', 'digits'].includes(start.data.item.instance.kind), 'первый шаг — не задача на память');
  const session = state().sessions.find((s: any) => s.id === start.data.sessionId);
  const answer = session.runtime.items[0].instance.answer;
  const skill = start.data.item.instance.skill;
  const before = state().skills.find((s: any) => s.profileId === profileId && s.skill === skill);
  fs.writeFileSync(marker, JSON.stringify({ profileId, sessionId: start.data.sessionId, item: start.data.item, skill, before, answer }));
} else {
  db = new DatabaseSync(file, { readOnly: true });
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const resumed = await post('/api/session', { action: 'start', profileId: saved.profileId });
  check(resumed.status === 200 && resumed.data.resumed && JSON.stringify(resumed.data.item) === JSON.stringify(saved.item), 'после перезапуска восстановлено то же задание');
  const body = { action: 'answer', sessionId: saved.sessionId, step: 0, answer: saved.answer };
  const result = await post('/api/session', body);
  check(result.status === 200 && result.data.correct && result.data.feedback.includes('сложность навыка не меняется'), 'восстановленное задание учтено как практика');
  const after = state().skills.find((s: any) => s.profileId === saved.profileId && s.skill === saved.skill);
  check(JSON.stringify(saved.before) === JSON.stringify(after), 'навык не изменён');
  const session = state().sessions.find((s: any) => s.id === saved.sessionId);
  check(session.runtime.taskAnswers[0].assisted === true, 'практика сохранена на сервере');
  const retry = await post('/api/session', body);
  check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(result.data), 'повтор не меняет результат и награду');
}
db.close();
