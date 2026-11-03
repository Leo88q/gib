/** Demo/isolated SQLite only: verify matching puzzle and retries through HTTP. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3018';
const database = process.env.GIB_SQLITE_FILE ?? 'data/attention-http-test.sqlite';
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
const headers = { 'content-type': 'application/json', 'x-demo-parent': `attention-${Date.now()}` };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
let db: DatabaseSync | null = null;
for (const age of [6, 9, 12]) {
  headers['x-demo-parent'] = `attention-${Date.now()}-${age}`;
  const profile = await post('/api/profile', { name: `Тест ${age}`, age });
  check(profile.status === 200, `создан профиль ${age} лет`);
  db ??= new DatabaseSync(database, { readOnly: true });
  let found = false;
  for (let day = 0; day < 3 && !found; day++) {
    const session = await post('/api/session', { action: 'start', profileId: profile.data.profile.id });
    check(session.status === 200, 'миссия открыта');
    let item = session.data.item;
    for (let step = 0; step < session.data.steps; step++) {
      const inst = item.type === 'task' ? item.instance : null;
      let answer: any;
      if (item.type === 'scenario') answer = { index: 0 };
      else if (inst.taskId === 'find-match') {
        found = true;
        check(inst.targetCard && !('answer' in inst), 'образец показан, ответ не отправлен');
        const state = JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
        const secret = state.sessions.find((s: any) => s.id === session.data.sessionId).runtime.items[step].instance.answer.cells as number[];
        const body = { action: 'answer', sessionId: session.data.sessionId, step };
        const duplicate = await post('/api/session', { ...body, answer: { cells: [secret[0], secret[0]] } });
        check(duplicate.status === 400, 'повтор индекса отклонён');
        const range = await post('/api/session', { ...body, answer: { cells: [inst.cards.length] } });
        check(range.status === 400, 'индекс за пределами поля отклонён');
        answer = { cells: [...secret].reverse() };
        const response = await post('/api/session', { ...body, answer });
        check(response.status === 200 && response.data.correct && response.data.feedback.includes('Фигурки как образец'), 'совпадения приняты в обратном порядке и разобраны');
        const retry = await post('/api/session', { ...body, answer });
        check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(response.data), 'повтор даёт ту же квитанцию');
        break;
      } else if (inst.kind === 'choice' || inst.kind === 'cards') answer = { index: 0 };
      else if (inst.kind === 'switch-rounds') answer = { cells: inst.rules.map(() => 0) };
      else if (inst.kind === 'order') answer = { cells: inst.steps.map((_: string, i: number) => i) };
      else if (inst.kind === 'memory' || inst.kind === 'symbol-memory' || inst.kind === 'finddiff') answer = { cells: [0] };
      else if (inst.kind === 'digits') answer = { digits: '1' };
      else answer = { targets: [] };
      const response = await post('/api/session', { action: 'answer', sessionId: session.data.sessionId, step, answer });
      check(response.status === 200, 'ответ предыдущего шага сохранён');
      item = response.data.next;
    }
  }
  check(found, 'игра на совпадения доступна в программе');
}
db?.close();
