/**
 * Смоук-тест игрового цикла: профиль → миссия → награды → миссии дня → значки → отчёт.
 * Запуск: node --experimental-strip-types scripts/smoke-game.ts (нужен запущенный dev-сервер)
 */
export {};
const BASE = process.env.BASE ?? 'http://localhost:3000';
const parentIdKey = `smoke-${Date.now()}`;

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-demo-parent': parentIdKey },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function get(path: string) {
  const res = await fetch(BASE + path, { headers: { 'x-demo-parent': parentIdKey } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

console.log('Профиль:');
const prof = await post('/api/profile', { parentId: parentIdKey, name: 'Тест', age: 9 });
check('профиль создан', prof.status === 200 && !!prof.data.profile?.id);
const profileId = prof.data.profile.id;

console.log('Старт миссии:');
const start = await post('/api/session', { action: 'start', profileId });
check('сессия начата', start.status === 200 && !!start.data.sessionId);
check('в шаге есть квест', typeof start.data.item?.quest === 'string' && start.data.item.quest.length > 10);
check(
  'шагов 4 или 5 (5 — день испытания)',
  start.data.steps === 4 || start.data.steps === 5,
  `steps=${start.data.steps}`,
);

console.log('Ответы:');
let last: any = start.data;
let rewards: any[] = [];
for (let i = 0; i < 8; i++) {
  const item = last.next ?? last.item;
  if (!item) break;
  let answer: any = {};
  if (item.type === 'task') {
    const inst = item.instance;
    if (inst.kind === 'choice') answer = { index: 0 };
    else if (inst.kind === 'memory' || inst.kind === 'symbol-memory' || inst.kind === 'finddiff') answer = { cells: [0] };
    else if (inst.kind === 'switch-rounds') answer = { cells: inst.rules.map(() => 0) };
    else if (inst.kind === 'order') answer = { cells: inst.steps.map((_: string, i: number) => i) };
    else if (inst.kind === 'digits') answer = { digits: '1' };
    else if (inst.kind === 'gonogo') answer = { targets: [] };
    else answer = { index: 0 };
  } else {
    answer = { index: 0 };
  }
  const ans = await post('/api/session', {
    action: 'answer',
    sessionId: start.data.sessionId,
    answer,
    ms: 1200,
    step: i,
  });
  if (ans.data.error) break;
  rewards.push(ans.data.reward ?? {});
  if (ans.data.done) {
    last = { done: true };
    break;
  }
  last = ans.data;
}
check('миссия завершена', last.done === true);
const finalReward = rewards[rewards.length - 1] ?? {};
check('начислен опыт', (finalReward.xp ?? 0) > 0, `xp=${finalReward.xp}`);
check('начислены монетки', (finalReward.coins ?? 0) > 0, `coins=${finalReward.coins}`);
check('есть звёзды за день', (finalReward.stars ?? 0) >= 1, `stars=${finalReward.stars}`);
check('задачи выполнены', (finalReward.missions?.length ?? 0) > 0);

console.log('Состояние игрока:');
const pl = await get(`/api/player?profileId=${profileId}`);
check('игрок создан', pl.status === 200 && pl.data.player?.level >= 1);
check('опыт сохранён', (pl.data.player?.xp ?? 0) > 0, `xp=${pl.data.player?.xp}`);
check('монетки сохранены', (pl.data.player?.coins ?? 0) > 0);
check('значки доступны', (pl.data.badges?.length ?? 0) > 10);
check('есть гардероб', (pl.data.shop?.length ?? 0) > 5);

console.log('Миссии дня:');
const claimable = (pl.data.missions ?? []).find((m: any) => m.done);
if (claimable) {
  const claim = await post('/api/player', { profileId, action: 'claim', id: claimable.id });
  check('миссия забрана', claim.status === 200 && claim.data.ok === true);
  check('монетки начислены за миссию', (claim.data.reward?.coins ?? 0) > 0);
} else {
  console.log('  --  ни одна миссия не готова (проверка пропущена)');
}

console.log('Гардероб:');
const shopItem = (pl.data.shop ?? [])[0];
const buy = await post('/api/player', { profileId, action: 'buy', id: shopItem.id });
if (buy.status === 200) {
  check('предмет куплен', buy.data.ok === true && buy.data.player.inventory.includes(shopItem.id));
  check('предмет надет', buy.data.player.equipped[shopItem.slot] === shopItem.id);
} else {
  check('покупка без монет отклонена', buy.status === 400 && buy.data.error === 'not_enough_coins');
}

console.log('Отчёт родителю:');
const rep = await get(`/api/report?profileId=${profileId}`);
check('в отчёте блок игрока', !!rep.data.report?.player);
check('в отчёте блок программы', !!rep.data.report?.program);
check('в отчёте навыки', (rep.data.report?.skills?.length ?? 0) === 6);

console.log('Программа:');
const prog = await get(`/api/program?profileId=${profileId}`);
check('12 недель', (prog.data.weeks?.length ?? 0) === 12);
check('прогресс 1 день', (prog.data.progress?.completedDays ?? 0) === 1);

console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
