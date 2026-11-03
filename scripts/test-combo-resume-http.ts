/** Two phases with server restart on an isolated demo SQLite database. */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3021';
const marker = process.env.MARKER ?? 'data/combo-resume-marker.json';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'combo-resume-test' };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
if (process.argv[2] === 'prepare') {
  const profile = await post('/api/profile', { name: 'Тест', age: 8 });
  check(profile.status === 200, 'профиль создан');
  const start = await post('/api/session', { action: 'start', profileId: profile.data.profile.id });
  check(start.status === 200 && start.data.combo === 0, 'новая миссия начинается без серии');
  const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/combo-resume-test.sqlite', { readOnly: true });
  const data = JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
  const secret = data.sessions.find((s: any) => s.id === start.data.sessionId).runtime.items[0].instance.answer;
  const payload = { action: 'answer', sessionId: start.data.sessionId, step: 0, answer: secret };
  const first = await post('/api/session', payload);
  check(first.status === 200 && first.data.correct && first.data.reward.combo === 1, 'верный ответ создаёт серию');
  fs.writeFileSync(marker, JSON.stringify({ profileId: profile.data.profile.id, sessionId: start.data.sessionId, payload, receipt: first.data, item: first.data.next })); db.close();
} else {
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const start = await post('/api/session', { action: 'start', profileId: saved.profileId });
  check(start.status === 200 && start.data.resumed && start.data.sessionId === saved.sessionId && start.data.step === 1, 'миссия восстановлена после перезапуска');
  check(start.data.combo === 1, 'текущая серия восстановлена');
  check(JSON.stringify(start.data.item) === JSON.stringify(saved.item), 'текущее задание не изменилось');
  const retry = await post('/api/session', saved.payload);
  check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(saved.receipt), 'повтор ответа не меняет награды и серию');
}
