/** Requires an isolated SQLite demo server; reads its test database to verify internal effects. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3014';
const headers = { 'content-type': 'application/json', 'x-demo-parent': `practice-${Date.now()}` };
async function post(path: string, body: object) {
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
function check(value: unknown, text: string): asserts value { if (!value) throw new Error(text); console.log('  ok', text); }
const profile = await post('/api/profile', { name: 'Тест', age: 8 });
check(profile.status === 200, 'тестовый профиль создан');
const profileId = profile.data.profile.id;
const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/assisted-http-test.sqlite', { readOnly: true });
const state = () => JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
let found = false;
for (let day = 0; day < 12 && !found; day++) {
  const start = await post('/api/session', { action: 'start', profileId });
  check(start.status === 200, 'миссия открыта');
  let item = start.data.item;
  for (let step = 0; step < start.data.steps; step++) {
    const session = state().sessions.find((s: any) => s.id === start.data.sessionId);
    const runtimeItem = session.runtime.items[step];
    const task = item.type === 'task' ? item.instance : null;
    const practice = !found && task && (task.kind === 'memory' || task.kind === 'symbol-memory' || task.kind === 'digits');
    const answer = item.type === 'scenario' ? { index: 0 } : practice ? { ...runtimeItem.instance.answer, assisted: true } : task.kind === 'choice' || task.kind === 'cards' ? { index: 0 } : task.kind === 'memory' || task.kind === 'symbol-memory' || task.kind === 'finddiff' ? { cells: [0] } : task.kind === 'switch-rounds' ? { cells: task.rules.map(() => 0) } : task.kind === 'order' ? { cells: task.steps.map((_: string, i: number) => i) } : task.kind === 'digits' ? { digits: '1' } : { targets: [] };
    const body = { action: 'answer', sessionId: start.data.sessionId, step, answer };
    const before = practice ? state().skills.find((s: any) => s.profileId === profileId && s.skill === task.skill) : null;
    if (practice) {
      const malformed = await post('/api/session', { ...body, answer: { ...answer, assisted: 'yes' } });
      check(malformed.status === 400, 'неверный признак помощи отклонён');
    }
    const res = await post('/api/session', body);
    check(res.status === 200, 'ответ принят');
    if (practice) {
      found = true;
      const after = state().skills.find((s: any) => s.profileId === profileId && s.skill === task.skill);
      check(res.data.correct && res.data.feedback.includes('сложность навыка не меняется'), 'ответ разобран и помечен как практика');
      check(JSON.stringify(before) === JSON.stringify(after), 'уровень, серия и оценка навыка не меняются');
      const retry = await post('/api/session', body);
      check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(res.data), 'повтор ответа с подсказкой идемпотентен');
      const conflict = await post('/api/session', { ...body, answer: { ...answer, assisted: false } });
      check(conflict.status === 409, 'нельзя подменить признак помощи при повторе');
    }
    item = res.data.next;
  }
}
check(found, 'задача на память найдена');
const reportResponse = await fetch(`${base}/api/report?profileId=${profileId}`, { headers });
const report = await reportResponse.json();
check(reportResponse.ok && report.report.assistedTasks === 1 && report.report.tasksDone >= 1, 'отчёт показывает практику отдельно, сохраняя количество заданий');
db.close();
