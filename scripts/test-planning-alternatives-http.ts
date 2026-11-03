/** Isolated demo database only: set planning level, then exercise a genuine generated mission. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3016';
const headers = { 'content-type': 'application/json', 'x-demo-parent': `plan-alt-${Date.now()}` };
async function post(body: object) { const r = await fetch(base + '/api/session', { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
function check(v: unknown, text: string): asserts v { if (!v) throw Error(text); console.log('  ok', text); }
function permutations(items: number[]): number[][] { return items.length ? items.flatMap((x, i) => permutations(items.filter((_, j) => i !== j)).map(p => [x, ...p])) : [[]]; }
const profileResponse = await fetch(base + '/api/profile', { method: 'POST', headers, body: JSON.stringify({ name: 'Тест', age: 9 }) });
const profile = (await profileResponse.json()).profile;
check(profileResponse.ok && profile?.id, 'создан изолированный профиль');
const db = new DatabaseSync(process.env.GIB_SQLITE_FILE ?? 'data/planning-alt-test.sqlite');
const read = () => JSON.parse((db.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data);
let found = false;
for (let day = 0; day < 30 && !found; day++) {
  const start = await post({ action: 'start', profileId: profile.id });
  check(start.status === 200, 'открыта миссия');
  let item = start.data.item;
  for (let step = 0; step < start.data.steps; step++) {
    const instance = item.type === 'task' ? item.instance : null;
    let answer: any;
    if (item.type === 'scenario') answer = { index: 0 };
    else if (instance.kind === 'switch-rounds') answer = { cells: instance.rules.map(() => 0) };
    else if (instance.kind === 'order') {
      const secret = read().sessions.find((s: any) => s.id === start.data.sessionId).runtime.items[step].instance.answer;
      check(!('answer' in instance) && !('before' in instance), 'зависимости и ключ скрыты до ответа');
      const alternative = permutations(secret.cells).find(cells => JSON.stringify(cells) !== JSON.stringify(secret.cells) && secret.before.every(([a,b]: [number,number]) => cells.indexOf(a) < cells.indexOf(b)));
      answer = { cells: alternative ?? secret.cells };
      if (alternative) found = true;
    } else if (instance.kind === 'choice' || instance.kind === 'cards') answer = { index: 0 };
    else if (instance.kind === 'memory' || instance.kind === 'symbol-memory' || instance.kind === 'finddiff') answer = { cells: [0] };
    else if (instance.kind === 'digits') answer = { digits: '1' };
    else answer = { targets: [] };
    const body = { action: 'answer', sessionId: start.data.sessionId, step, answer };
    const response = await post(body);
    check(response.status === 200, 'ответ сохранён');
    if (found && instance?.kind === 'order') {
      check(response.data.correct === true, 'альтернативный допустимый порядок принят как верный');
      const repeat = await post(body);
      check(JSON.stringify(repeat.data) === JSON.stringify(response.data), 'повтор не начисляет награды заново');
      break;
    }
    item = response.data.next;
  }
  if (!found) {
    db.exec('BEGIN IMMEDIATE');
    const state = read();
    const skill = state.skills.find((s: any) => s.profileId === profile.id && s.skill === 'planning');
    skill.level = 3; skill.streak = 0;
    db.prepare('UPDATE app_state SET data = ? WHERE id=1').run(JSON.stringify(state));
    db.exec('COMMIT');
  }
}
check(found, 'найден и проверен план с независимыми действиями');
db.close();
