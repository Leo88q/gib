/** Demo/isolated SQLite only. Reads server's answer key to verify response handling. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3017';
const headers = { 'content-type': 'application/json', 'x-demo-parent': `logic-${Date.now()}` };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
const profile = await post('/api/profile', { name: 'Тест', age: 6 });
check(profile.status === 200, 'профиль создан');
const profileId = profile.data.profile.id;
const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/logic-http-test.sqlite', { readOnly: true });
const read = () => JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
let found = false;
for (let day = 0; day < 30 && !found; day++) {
  const start = await post('/api/session', { action: 'start', profileId });
  check(start.status === 200, 'миссия открыта');
  let item = start.data.item;
  for (let step = 0; step < start.data.steps; step++) {
    const task = item.type === 'task' ? item.instance : null;
    let answer: any;
    if (item.type === 'scenario') answer = { index: 0 };
    else if (task.taskId === 'logic' && task.logicBoard?.mode === 'add') {
      found = true;
      check(task.logicBoard.counters.length === 2 && !('answer' in task) && !task.options.some((o: any) => 'correct' in o), 'условие с монетками доступно, ключ ответа скрыт');
      const secret = read().sessions.find((s: any) => s.id === start.data.sessionId).runtime.items[step].instance.answer;
      answer = { index: secret.index, assisted: true };
    } else if (task.kind === 'choice' || task.kind === 'cards') answer = { index: 0 };
    else if (task.kind === 'switch-rounds') answer = { cells: task.rules.map(() => 0) };
    else if (task.kind === 'order') answer = { cells: task.steps.map((_: string, i: number) => i) };
    else if (task.kind === 'memory' || task.kind === 'symbol-memory' || task.kind === 'finddiff') answer = { cells: [0] };
    else if (task.kind === 'digits') answer = { digits: '1' };
    else answer = { targets: [] };
    const before = found ? read().skills.find((s: any) => s.profileId === profileId && s.skill === 'logic') : null;
    const body = { action: 'answer', sessionId: start.data.sessionId, step, answer };
    const response = await post('/api/session', body);
    check(response.status === 200, 'ответ сохранён');
    if (found) {
      const after = read().skills.find((s: any) => s.profileId === profileId && s.skill === 'logic');
      check(response.data.correct && response.data.feedback.includes(' + ') && response.data.feedback.includes('практика'), 'верное решение и разбор практики');
      check(JSON.stringify(before) === JSON.stringify(after), 'практика не меняет сложность навыка');
      const retry = await post('/api/session', body);
      check(JSON.stringify(retry.data) === JSON.stringify(response.data), 'повтор ответа идемпотентен');
      break;
    }
    item = response.data.next;
  }
}
check(found, 'найдена и проверена логическая задача с монетками');
db.close();
