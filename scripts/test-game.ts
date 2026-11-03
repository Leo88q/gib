/**
 * Проверка игровой механики: уровни, звёзды, миссии, значки, гардероб.
 * Запуск: npm run test:game
 */
export {};
import {
  BADGES,
  COINS,
  LEVELS,
  MISSIONS,
  SHOP,
  XP,
  levelOf,
  missionsForDay,
  starsForDay,
  xpToNext,
} from '../lib/gamification.ts';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

console.log('Уровни:');
check('уровень 1 на 0 XP', levelOf(0).level === 1);
check('уровень 2 на 60 XP', levelOf(60).level === 2);
check('уровень 7 на 920 XP', levelOf(920).level === 7);
check('последний уровень — максимум', levelOf(999999).level === LEVELS[LEVELS.length - 1].level);
const prog = xpToNext(100);
check('прогресс уровня считается', prog.current === 40 && prog.need === 80 && prog.percent === 50, JSON.stringify(prog));

console.log('Звёзды за день:');
check('идеальный день = 3 звезды', starsForDay(3, 3, 'good') === 3);
check('хороший день = 2 звезды', starsForDay(3, 2, 'partial') === 2);
check('обычный день = 1 звезда', starsForDay(3, 1, 'bad') === 1);
check('3 верных задания без оценки истории = 3 звезды', starsForDay(3, 3, undefined) === 3);
check('3 верных + лучший выбор = 3 звезды', starsForDay(3, 3, 'good') === 3);
check('2 верных + лучший выбор = 2 звезды', starsForDay(3, 2, 'good') === 2);

console.log('Миссии дня:');
for (let d = 0; d < 60; d++) {
  const m = missionsForDay(d);
  if (m.length !== 3) {
    check(`день ${d}: три миссии`, false, `получено ${m.length}`);
    break;
  }
}
check('в каждый день программы — 3 миссии', true);
check('в первый день миссия «Помощь другу»', missionsForDay(0).some((m) => m.id === 'helper'));
check('на 5-й день недели — испытание', missionsForDay(4).some((m) => m.id === 'boss'));
check('на 10-й день недели — испытание', missionsForDay(9).some((m) => m.id === 'boss'));
check('через 7 дней — миссия «Идеальный день»', missionsForDay(6).some((m) => m.id === 'perfect'));
check('все миссии существуют в каталоге', missionsForDay(33).every((m) => MISSIONS.some((x) => x.id === m.id)));
check('у миссий есть цель > 0', MISSIONS.every((m) => m.target > 0));

console.log('Значки:');
check('значков больше 20', BADGES.length > 20, `значков=${BADGES.length}`);
check('у значков есть уникальные id', new Set(BADGES.map((b) => b.id)).size === BADGES.length);
check('есть значки за каждую неделю', BADGES.filter((b) => /^week_\d{2}$/.test(b.id)).length === 12);
check('у значков заполнены названия', BADGES.every((b) => b.title && b.desc && b.glyph));

console.log('Гардероб:');
check('предметов больше 10', SHOP.length > 10, `предметов=${SHOP.length}`);
check('у предметов уникальные id', new Set(SHOP.map((i) => i.id)).size === SHOP.length);
check('цены положительные', SHOP.every((i) => i.price > 0));
check('есть предметы на все слоты', ['head', 'body', 'pet', 'room'].every((s) => SHOP.some((i) => i.slot === s)));

console.log('Награды:');
check('опыт за верный ответ больше, чем за ошибку', XP.taskCorrect > XP.taskWrong);
check('награда за историю определена', COINS.scenarioGood > 0);

console.log('Начисление наград (на реальном состоянии):');
const { store } = await import('../lib/store.ts');
const { refreshMissions, completeDay, missionViews, claimMission, buyItem, ensureMissions, earnScenario } =
  await import('../lib/engine/rewards.ts');

const pid = 'test-game-profile';
const player = store.playerState(pid);
player.xp = 0;
player.coins = 200;
player.stars = 0;
player.streak = 0;
player.bestStreak = 0;
player.badges = [];
player.inventory = [];
player.stats = { days: 0, tasks: 0, correctTasks: 0, scenarios: 0, goodScenarios: 0, bestCombo: 0, perfectDays: 0, minutes: 0 };
player.missions = { day: -1, ids: [], progress: {}, claimed: [] };
player.lastActiveDay = '';
const rewardTests = (['good', 'partial', 'bad'] as const).map(quality => {
  const copy = structuredClone(player);
  const result = earnScenario(copy, quality);
  return { xp: result.xp, coins: result.coins, count: copy.stats.scenarios, good: copy.stats.goodScenarios };
});
check('награда и участие в истории одинаковы для любого выбора', rewardTests.every(r => JSON.stringify(r) === JSON.stringify(rewardTests[0])));
check('звёзды не зависят от выбора в истории', ['good', 'partial', 'bad'].every(q => starsForDay(3, 3, q as 'good' | 'partial' | 'bad') === 3));
const attendanceBadge = BADGES.find(b => b.id === 'three_days')!;
check('значок за занятия не требует ежедневной серии', attendanceBadge.check({ stats: { ...player.stats, days: 3 }, badges: [], weekDone: 0, perfectDays: 0, inventory: [], skills: [] }));
ensureMissions(player, 0);
check('на день выдано 3 миссии', missionViews(player).length === 3);

refreshMissions(player, {
  dayIndex: 0,
  tasksDone: 3,
  comboBest: 5,
  correctStreak: 3,
  goodChoice: true,
  perfectDay: false,
  bossPassed: false,
  stars: 2,
});
const views = missionViews(player);
check('миссия «Серия ×5» засчитана', views.find((m) => m.id === 'combo5')?.done === true);
check('миссия «Без промахов» засчитана', views.find((m) => m.id === 'careful3')?.done === true);
check('миссия «Помощь другу» засчитана', views.find((m) => m.id === 'helper')?.done === true);

const reward = claimMission(player, 'combo5');
check('миссия забирается', reward !== null && reward.coins === COINS.mission);
check('повторно миссию не забрать', claimMission(player, 'combo5') === null);

const done = completeDay(player, {
  tasks: 3,
  correct: 3,
  quality: 'good',
  seconds: 600,
  isBoss: false,
  dayIndex: 0,
  weekDone: 0,
  comboBest: 5,
  correctStreak: 3,
});
check('идеальный день даёт 3 звезды', done.stars === 3);
check('выдан значок «Первый шаг»', done.newBadges.includes('first_step'));
check('выдан значок «Идеальный день»', done.newBadges.includes('perfect_day'));
check('старые поля серии не меняются при завершении дня', player.streak === 0 && player.bestStreak === 0 && player.lastActiveDay === '');
check('опыт накоплен', player.xp > 0);
check('заработаны монетки', player.coins > 200);
const beforeXp = player.xp, beforeCoins = player.coins;
const auto = ensureMissions(player, 1);
check('незабранные выполненные миссии автоматически начисляются при смене дня', auto.count === 2 && player.xp === beforeXp + auto.xp && player.coins === beforeCoins + auto.coins);
const onceXp = player.xp, onceCoins = player.coins;
const autoAgain = ensureMissions(player, 1);
check('повторное открытие дня не начисляет миссии второй раз', autoAgain.count === 0 && player.xp === onceXp && player.coins === onceCoins);
player.stats.bestCombo = 50;
completeDay(player, { tasks: 3, correct: 0, quality: 'bad', seconds: 10, isBoss: false, dayIndex: 1, weekDone: 0, comboBest: 0, correctStreak: 0 });
check('старый рекорд комбо не завершает миссию текущего дня', (missionViews(player).find(m => m.id === 'careful3')?.progress ?? 0) === 0 && (missionViews(player).find(m => m.id === 'combo5')?.progress ?? 0) === 0);


const bought = buyItem(player, 'head_cap', 40);
check('покупка прошла', bought.ok && player.inventory.includes('head_cap'));
check('повторная покупка отклонена', buyItem(player, 'head_cap', 40).error === 'already_owned');
check('не хватает монет — отказ', buyItem(player, 'room_lamp', 100000).error === 'not_enough_coins');
store.setPlayerState(player);

console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
