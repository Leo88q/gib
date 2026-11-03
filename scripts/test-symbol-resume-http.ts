/** Two phases with a server restart, only on an isolated demo SQLite DB. */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3019';
const marker = process.env.MARKER ?? 'data/symbol-resume-marker.json';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'symbol-resume-test' };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
function answer(item: any) {
  if (item.type === 'scenario' || item.instance.kind === 'choice' || item.instance.kind === 'cards') return { index: 0 };
  const task = item.instance;
  if (task.kind === 'switch-rounds') return { cells: task.rules.map(() => 0) };
  if (task.kind === 'order') return { cells: task.steps.map((_: string, i: number) => i) };
  if (['memory', 'symbol-memory', 'finddiff'].includes(task.kind)) return { cells: [0] };
  if (task.kind === 'digits') return { digits: '1' };
  return { targets: [] };
}
if (process.argv[2] === 'prepare') {
  const profile = await post('/api/profile', { name: 'Тест', age: 9 });
  check(profile.status === 200, 'создан профиль');
  let found = false;
  for (let day = 0; day < 10 && !found; day++) {
    const start = await post('/api/session', { action: 'start', profileId: profile.data.profile.id });
    check(start.status === 200 && !start.data.resumed, 'миссия открыта');
    let item = start.data.item;
    for (let step = 0; step < start.data.steps; step++) {
      if (item.type === 'task' && item.instance.kind === 'symbol-memory') {
        check(!('answer' in item.instance), 'ключ ответа не отправляется');
        fs.writeFileSync(marker, JSON.stringify({ profileId: profile.data.profile.id, sessionId: start.data.sessionId, step, item }));
        found = true; break;
      }
      const res = await post('/api/session', { action: 'answer', sessionId: start.data.sessionId, step, answer: answer(item) });
      check(res.status === 200, 'шаг сохранён');
      item = res.data.next;
    }
  }
  check(found, 'новое упражнение найдено');
} else {
  const expected = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const start = await post('/api/session', { action: 'start', profileId: expected.profileId });
  check(start.status === 200 && start.data.resumed && start.data.step === expected.step && start.data.sessionId === expected.sessionId, 'упражнение восстановлено после перезапуска');
  check(JSON.stringify(start.data.item) === JSON.stringify(expected.item), 'те же значки и последовательность');
  const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/symbol-resume-test.sqlite', { readOnly: true });
  const state = () => JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
  const before = state().skills.find((s: any) => s.profileId === expected.profileId && s.skill === 'working_memory');
  const body = { action: 'answer', sessionId: expected.sessionId, step: expected.step, answer: { cells: expected.item.instance.cells } };
  const duplicate = await post('/api/session', { ...body, answer: { cells: [0, 0] } });
  check(duplicate.status === 400, 'дубли отклонены');
  const response = await post('/api/session', body);
  check(response.status === 200 && response.data.correct && response.data.feedback.includes('практика'), 'повторный показ учтён как практика без флага клиента');
  const after = state().skills.find((s: any) => s.profileId === expected.profileId && s.skill === 'working_memory');
  check(JSON.stringify(before) === JSON.stringify(after), 'настройка навыка не изменилась');
  const retry = await post('/api/session', body);
  check(JSON.stringify(retry.data) === JSON.stringify(response.data), 'повтор отдаёт прежний результат без повторной награды');
  let result = response.data, step = expected.step + 1;
  while (!result.done) {
    const next = await post('/api/session', { action: 'answer', sessionId: expected.sessionId, step: step++, answer: answer(result.next) });
    check(next.status === 200, 'оставшийся шаг сохранён'); result = next.data;
  }
  const report = await fetch(`${base}/api/report?profileId=${expected.profileId}`, { headers }).then(r => r.json());
  check(report.report.assistedTasks >= 1, 'практика отражена в отчёте');
  db.close();
}
