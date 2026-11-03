/** Isolated demo SQLite: run prepare and resume across a server restart. */
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://localhost:3000', file = process.env.FAMILY_TEST_FILE ?? 'data/family-http.json';
const phase = process.argv[2];
async function req(parent: string, path: string, body?: object, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-demo-parent': parent }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json() };
}
function check(v: unknown, label: string): asserts v { if (!v) throw Error(label); console.log('  ok', label); }
async function main() {
  if (phase === 'prepare') {
    const rows = [];
    for (const age of [6,9,12]) {
      const parent = `family-${age}-${Date.now()}`;
      const profile = await req(parent, '/api/profile', { name:'Тест', age }); const id = profile.data.profile.id;
      const initial = await req(parent, `/api/family?profileId=${id}`);
      check(initial.status === 200 && initial.data.version === 0 && initial.data.ideas.length === 6, `${age}: шесть возрастных идей без обязательства`);
      check((await req('foreign', `/api/family?profileId=${id}`)).status === 404, 'чужая семья недоступна');
      const choose = { profileId:id, action:'choose', expectedVersion:0, operationId:'choose1', ideaId:'story' };
      const picked = await req(parent, '/api/family', choose);
      check(picked.status === 200 && picked.data.current.status === 'chosen', 'идея выбрана');
      check((await req('foreign', '/api/family', { ...choose, operationId:'bad' })).status === 404, 'чужое изменение отклонено');
      check((await req(parent, '/api/family', { ...choose, extra: 'secret' })).status === 400, 'произвольный текст не принимается');
      const report = { profileId:id, action:'report', expectedVersion:1, operationId:'report1' };
      const response = await req(parent, '/api/family', report);
      check(response.status === 200 && response.data.current.status === 'reported', 'отметка ожидает подтверждения');
      const player = await req(parent, `/api/player?profileId=${id}`);
      rows.push({ parent, id, age, xp:player.data.player.xp, coins:player.data.player.coins });
    }
    fs.writeFileSync(file, JSON.stringify(rows));
  } else if (phase === 'resume') {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const row of rows) {
      const resumed = await req(row.parent, `/api/family?profileId=${row.id}`);
      check(resumed.data.version === 2 && resumed.data.current.status === 'reported', `${row.age}: состояние восстановлено`);
      const confirm = { profileId:row.id, action:'confirm', expectedVersion:2, operationId:'confirm1' };
      const repeated = await Promise.all(Array.from({length:6}, () => req(row.parent, '/api/family', confirm)));
      check(repeated.every(x => x.status === 200 && x.data.completed === 1) && repeated.filter(x => x.data.replay === false).length === 1, 'параллельные повторы дают одну отметку');
      check((await req(row.parent, '/api/family', { ...confirm, operationId:'another' })).status === 409, 'устаревшая версия отклонена');
      check((await req(row.parent, '/api/family', { ...confirm, action:'cancel' })).status === 409, 'повтор с изменённой операцией отклонён');
      const player = await req(row.parent, `/api/player?profileId=${row.id}`);
      check(player.data.player.xp === row.xp && player.data.player.coins === row.coins, 'семейная отметка не даёт игровой валюты');
      const exp = await req(row.parent, `/api/profile/export?profileId=${row.id}`);
      check(exp.data.player[0].family.completed === 1 && !JSON.stringify(exp.data).includes('fingerprint'), 'экспорт содержит состояние без технических квитанций');
      const close = await req(row.parent, '/api/family', { profileId:row.id, action:'close', expectedVersion:3, operationId:'close' });
      check(close.data.current === null, 'подтверждённая идея закрыта');
      const start = await req(row.parent, '/api/family', { profileId:row.id, action:'choose', expectedVersion:4, operationId:'choose2', ideaId:'colors' });
      const cancel = await req(row.parent, '/api/family', { profileId:row.id, action:'cancel', expectedVersion:5, operationId:'cancel' });
      check(start.status === 200 && cancel.data.current === null && cancel.data.completed === 1, 'отказ не меняет общую отметку');
      check((await req(row.parent, `/api/profile?profileId=${row.id}`, undefined, 'DELETE')).status === 200 && (await req(row.parent, `/api/family?profileId=${row.id}`)).status === 404, 'удаление профиля удаляет семейные данные');
    }
    fs.unlinkSync(file);
  } else throw Error('use prepare or resume');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
