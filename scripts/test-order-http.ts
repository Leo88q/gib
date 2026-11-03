/** Integration test against an isolated demo SQLite store; never use a real database. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3012';
const headers = { 'content-type': 'application/json', 'x-demo-parent': `order-test-${Date.now()}` };
async function post(path: string, payload: object) {
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { status: response.status, data: await response.json() };
}
function check(value: unknown, text: string): asserts value { if (!value) throw new Error(text); console.log('  ok', text); }
const profile = await post('/api/profile', { name: 'Тест', age: 8 });
check(profile.status === 200, 'создан тестовый профиль');
const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/order-http-test.sqlite', { readOnly: true });

let found = false;
for (let day = 0; day < 20 && !found; day++) {
  const start = await post('/api/session', { action: 'start', profileId: profile.data.profile.id });
  check(start.status === 200, `открыта миссия ${day + 1}`);
  let item = start.data.item;
  for (let step = 0; step < start.data.steps; step++) {
    let answer: any;
    if (item.type === 'scenario') answer = { index: 0 };
    else {
      const task = item.instance;
      check(!('answer' in task), 'ключ ответа не отправляется клиенту');
      if (task.kind === 'order') {
        found = true;
        const n = task.steps.length;
        const state: any = JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
        const session = state.sessions.find((s: any) => s.id === start.data.sessionId);
        const correct = session.runtime.items[step].instance.answer.cells;
        const body = { action: 'answer', sessionId: start.data.sessionId, step };
        for (const cells of [correct.slice(1), Array(n).fill(0), correct.map((x: number, i: number) => i ? x : n)]) {
          const res = await post('/api/session', { ...body, answer: { cells } });
          check(res.status === 400, 'неполный, повторённый или выходящий за границы индекс отклонён');
        }
        answer = { cells: correct };
        const res = await post('/api/session', { ...body, answer });
        check(res.status === 200 && res.data.correct, 'собранный в правильном порядке план принят');
        const retry = await post('/api/session', { ...body, answer });
        check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(res.data), 'повтор ответа не начисляет награду заново');
        break;
      }
      if (task.kind === 'switch-rounds') answer = { cells: task.rules.map(() => 0) };
      else if (task.kind === 'digits') answer = { digits: '1' };
      else if (task.kind === 'memory' || task.kind === 'symbol-memory' || task.kind === 'finddiff') answer = { cells: [0] };
      else if (task.kind === 'gonogo') answer = { targets: [] };
      else answer = { index: 0 };
    }
    const res = await post('/api/session', { action: 'answer', sessionId: start.data.sessionId, step, answer });
    check(res.status === 200, 'ответ шага сохранён');
    item = res.data.next;
  }
}
check(found, 'в программе найдено новое задание на планирование');
db.close();
