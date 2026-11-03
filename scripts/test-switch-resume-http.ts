/** Run prepare then resume after server restart, against an isolated demo SQLite database. */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3020';
const marker = process.env.MARKER ?? 'data/switch-resume-marker.json';
const database = process.env.GIB_SQLITE_FILE ?? 'data/switch-resume-test.sqlite';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'switch-resume-test' };
async function post(path: string, body: object) { const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
function answer(item: any) {
  if (item.type === 'scenario' || ['choice', 'cards'].includes(item.instance.kind)) return { index: 0 };
  const task = item.instance;
  if (task.kind === 'switch-rounds') return { cells: task.rules.map(() => 0) };
  if (task.kind === 'order') return { cells: task.steps.map((_: string, i: number) => i) };
  if (['memory', 'symbol-memory', 'finddiff'].includes(task.kind)) return { cells: [0] };
  if (task.kind === 'digits') return { digits: '1' };
  return { targets: [] };
}
if (process.argv[2] === 'prepare') {
  const profile = await post('/api/profile', { name: 'Тест', age: 12 });
  check(profile.status === 200, 'создан тестовый профиль');
  const db = new DatabaseSync(database);
  let found = false;
  for (let day = 0; day < 15 && !found; day++) {
    const start = await post('/api/session', { action: 'start', profileId: profile.data.profile.id });
    check(start.status === 200 && !start.data.resumed, 'открыта миссия');
    let item = start.data.item;
    for (let step = 0; step < start.data.steps; step++) {
      if (item.type === 'task' && item.instance.kind === 'switch-rounds') {
        check(item.instance.rules.length === 3 && !('answer' in item.instance), 'три раунда, ключ не отправлен');
        const data = JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
        const secret = data.sessions.find((s: any) => s.id === start.data.sessionId).runtime.items[step].instance.answer.cells;
        check(secret[0] === secret[2] && secret[0] !== secret[1], 'при возвращении прежнего правила совпадает и ответ');
        fs.writeFileSync(marker, JSON.stringify({ profileId: profile.data.profile.id, sessionId: start.data.sessionId, step, item, secret }));
        found = true; break;
      }
      const result = await post('/api/session', { action: 'answer', sessionId: start.data.sessionId, step, answer: answer(item) });
      check(result.status === 200, 'шаг сохранён'); item = result.data.next;
    }
    if (!found) {
      db.exec('BEGIN IMMEDIATE');
      const data = JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
      const skill = data.skills.find((s: any) => s.profileId === profile.data.profile.id && s.skill === 'flexibility');
      skill.level = 3; skill.streak = 0;
      db.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(data)); db.exec('COMMIT');
    }
  }
  db.close(); check(found, 'найдено упражнение на смену правил');
} else {
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const resumed = await post('/api/session', { action: 'start', profileId: saved.profileId });
  check(resumed.status === 200 && resumed.data.resumed && resumed.data.sessionId === saved.sessionId && resumed.data.step === saved.step, 'сессия восстановлена');
  check(JSON.stringify(resumed.data.item) === JSON.stringify(saved.item), 'те же карточки и правила после перезапуска');
  const body = { action: 'answer', sessionId: saved.sessionId, step: saved.step };
  for (const cells of [saved.secret.slice(1), [0, 1, 4], [0, 1, 0.5]]) {
    const invalid = await post('/api/session', { ...body, answer: { cells } });
    check(invalid.status === 400, 'неполный или некорректный ответ отклонён');
  }
  const response = await post('/api/session', { ...body, answer: { cells: saved.secret } });
  check(response.status === 200 && response.data.correct && response.data.feedback.includes('По форме') && response.data.feedback.includes('По цвету'), 'верный ответ с повторяющимся индексом принят и разобран');
  const retry = await post('/api/session', { ...body, answer: { cells: saved.secret } });
  check(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(response.data), 'повтор выдаёт тот же результат без повторной награды');
  const conflict = await post('/api/session', { ...body, answer: { cells: saved.secret.map((n: number) => (n + 1) % 4) } });
  check(conflict.status === 409, 'изменённый повтор не засчитывается');
}
