import { calendarDay, DEFAULT_TIME_ZONE } from './calendar.ts';
/**
 * Игровая механика: уровни, опыт, монетки, звёзды, ежедневные миссии,
 * значки (achievements) и косметический гардероб.
 *
 * Важно для РФ: ребёнок не тратит реальные деньги — только игровые монетки,
 * которые начисляются за реальные действия. Покупки за реальные рубли
 * делает родитель (см. app/api/subscribe).
 */
import type { PlayerState, PlayerStats } from './types.ts';

/* ------------------------------- уровни -------------------------------- */

export type LevelDef = { level: number; title: string; minXp: number; next: number };

export const LEVELS: LevelDef[] = [
  { level: 1, title: 'Новичок', minXp: 0, next: 60 },
  { level: 2, title: 'Ученик', minXp: 60, next: 140 },
  { level: 3, title: 'Исследователь', minXp: 140, next: 260 },
  { level: 4, title: 'Умница', minXp: 260, next: 420 },
  { level: 5, title: 'Знаток', minXp: 420, next: 640 },
  { level: 6, title: 'Стратег', minXp: 640, next: 920 },
  { level: 7, title: 'Мастер мысли', minXp: 920, next: 1400 },
  { level: 8, title: 'Легенда района', minXp: 1400, next: 999999 },
];

export function levelOf(xp: number): LevelDef {
  let found = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.minXp) found = l;
  return found;
}

export function xpToNext(xp: number): { current: number; need: number; percent: number } {
  const lvl = levelOf(xp);
  const span = lvl.next - lvl.minXp;
  const current = xp - lvl.minXp;
  return { current, need: span, percent: Math.max(0, Math.min(100, Math.round((current / span) * 100))) };
}

/* ------------------------------- награды ------------------------------- */

/**
 * Награды за участие, а не за качество.
 *
 * Раньше был бонус за «идеальный день» (40 XP + 12 монет) и прибавка за каждый
 * шаг серии верных ответов. Вместе с миссиями «Серия ×5» и «Без промахов» это
 * дважды поощряло безошибочность и подталкивало ребёнка не рисковать.
 * Для 5–13 лет такой стимул работает против смысла упражнений, поэтому бонусы
 * за точность убраны: верный и неверный ответ по-прежнему дают разное, но
 * «идеальности» больше никто не требует.
 */
export const XP = {
  taskCorrect: 12,
  taskWrong: 4,
  scenarioGood: 25,
  scenarioPartial: 12,
  scenarioBad: 6,
  dayComplete: 30,
  bossComplete: 50,
  mission: 35,
};

export const COINS = {
  taskCorrect: 3,
  taskWrong: 1,
  scenarioGood: 8,
  scenarioPartial: 4,
  scenarioBad: 2,
  mission: 15,
  badge: 20,
};

/* -------------------------------- звёзды ------------------------------- */

/**
 * 1 — день пройден, 2 — хороший день, 3 — без ошибок.
 *
 * Звёзды остаются видимой отметкой сделанного, но за них больше не дают
 * отдельных XP и монет: иначе «идеальность» снова становится заработком.
 */
export function starsForDay(tasks: number, correct: number, _quality?: 'good' | 'partial' | 'bad') {
  if (tasks > 0 && correct === tasks) return 3;
  if (correct >= Math.max(2, tasks - 1)) return 2;
  return 1;
}

/* -------------------------------- значки ------------------------------- */

export type BadgeCtx = {
  stats: PlayerStats;
  badges: string[];
  weekDone: number; // сколько недель закрыто
  perfectDays: number;
  inventory: string[];
  skills: { skill: string; ability: number }[];
};

export type BadgeDef = {
  id: string;
  title: string;
  desc: string;
  glyph: string;
  tier: 'bronze' | 'silver' | 'gold';
  check: (c: BadgeCtx) => boolean;
};

export const BADGES: BadgeDef[] = [
  {
    id: 'first_step',
    title: 'Первый шаг',
    desc: 'Пройти первый день программы',
    glyph: '👣',
    tier: 'bronze',
    check: (c) => c.stats.days >= 1,
  },
  {
    id: 'three_days',
    title: 'Три занятия',
    desc: 'Завершить 3 занятия в удобном темпе',
    glyph: '🔥',
    tier: 'bronze',
    check: (c) => c.stats.days >= 3,
  },
  {
    id: 'streak_week',
    title: 'Семь занятий',
    desc: 'Завершить 7 занятий в удобном темпе',
    glyph: '📆',
    tier: 'silver',
    check: (c) => c.stats.days >= 7,
  },
  {
    id: 'month_streak',
    title: 'Путешествие продолжается',
    desc: 'Завершить 21 занятие в удобном темпе',
    glyph: '🏔️',
    tier: 'gold',
    check: (c) => c.stats.days >= 21,
  },
  {
    // Значки за «идеальные дни» и серию верных ответов убраны: они превращали
    // отсутствие ошибок в цель. Уже выданные значки у профилей остаются в их
    // коллекции — задним числом ничего не отнимаем, но новых таких не выдаём.
    // Legacy: perfect_day, perfect_5, combo_master.
    id: 'five_days',
    title: 'Пять занятий',
    desc: 'Завершить 5 занятий',
    glyph: '🌱',
    tier: 'bronze',
    check: (c) => c.stats.days >= 5,
  },
  {
    id: 'ten_days',
    title: 'Десять занятий',
    desc: 'Завершить 10 занятий',
    glyph: '🌿',
    tier: 'silver',
    check: (c) => c.stats.days >= 10,
  },
  {
    id: 'good_choice',
    title: 'Исследователь историй',
    desc: 'Пять раз принять участие в истории',
    glyph: '🤝',
    tier: 'bronze',
    check: (c) => c.stats.scenarios >= 5,
  },
  {
    id: 'collector',
    title: 'Коллекционер',
    desc: 'Собрать 10 значков',
    glyph: '🏅',
    tier: 'silver',
    check: (c) => c.badges.length >= 10,
  },
  {
    id: 'dresser',
    title: 'Модник',
    desc: 'Купить 3 вещи в гардеробе',
    glyph: '👕',
    tier: 'bronze',
    check: (c) => c.inventory.length >= 3,
  },
  {
    id: 'pet_friend',
    title: 'Друг',
    desc: 'Завести питомца',
    glyph: '🐾',
    tier: 'bronze',
    check: (c) => c.inventory.some((i) => i.startsWith('pet_')),
  },
  {
    id: 'tasks_100',
    title: 'Сто заданий',
    desc: 'Выполнить 100 когнитивных заданий',
    glyph: '🧩',
    tier: 'silver',
    check: (c) => c.stats.tasks >= 100,
  },
  {
    id: 'tasks_500',
    title: 'Пятьсот заданий',
    desc: 'Выполнить 500 когнитивных заданий',
    glyph: '🚀',
    tier: 'gold',
    check: (c) => c.stats.tasks >= 500,
  },
  {
    id: 'all_skills',
    title: 'Все навыки',
    desc: 'Поднять каждый навык выше 50%',
    glyph: '🧭',
    tier: 'gold',
    check: (c) => c.skills.length >= 6 && c.skills.every((s) => s.ability >= 0.5),
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `week_${String(i + 1).padStart(2, '0')}`,
    title: `Район ${i + 1}`,
    desc: `Закрыть неделю ${i + 1} программы`,
    glyph: '🏘️',
    tier: (i + 1) % 4 === 0 ? ('gold' as const) : (i + 1) % 2 === 0 ? ('silver' as const) : ('bronze' as const),
    check: (c: BadgeCtx) => c.weekDone >= i + 1,
  })),
];

export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

/* -------------------------------- миссии ------------------------------- */

export type MissionCtx = {
  dayIndex: number;
  tasksDone: number;
  comboBest: number;
  correctStreak: number;
  goodChoice: boolean;
  perfectDay: boolean;
  bossPassed: boolean;
  stars: number;
};

export type MissionDef = {
  id: string;
  title: string;
  desc: string;
  glyph: string;
  target: number;
  progress: (c: MissionCtx) => number;
};

export const MISSIONS: MissionDef[] = [
  {
    // Было «Серия ×5» за 5 верных подряд: поощряло не ошибаться и бросать при сбое.
    id: 'practice5',
    title: 'Пять заданий',
    desc: 'Пройти пять заданий в своём темпе',
    glyph: '🌟',
    target: 5,
    progress: (c) => c.tasksDone,
  },
  {
    // Было «Без промахов» за 3 верных подряд: то же давление точности.
    id: 'tries3',
    title: 'Не сдаваться',
    desc: 'Попробовать три задания, даже если что-то не получилось',
    glyph: '💪',
    target: 3,
    progress: (c) => c.tasksDone,
  },
  {
    id: 'helper',
    title: 'Помощь другу',
    desc: 'Попробовать жизненную историю',
    glyph: '🤝',
    target: 1,
    progress: (c) => (c.goodChoice ? 1 : 0),
  },
  {
    id: 'warmup',
    title: 'Разминка',
    desc: 'Пройти 3 задания за день',
    glyph: '🏃',
    target: 3,
    progress: (c) => c.tasksDone,
  },
  {
    id: 'stars2',
    title: 'Две звезды',
    desc: 'Заработать 2 звезды за день',
    glyph: '⭐',
    target: 2,
    progress: (c) => c.stars,
  },
  {
    // Было «Идеальный день» за безошибочность. Теперь награда за завершённый день:
    // факт участия виден, а «идеальности» никто не требует.
    id: 'dayDone',
    title: 'День завершён',
    desc: 'Дойти до конца дня в своём темпе',
    glyph: '🎒',
    target: 1,
    progress: (c) => (c.tasksDone >= 3 ? 1 : 0),
  },
  {
    id: 'boss',
    title: 'Испытание дня',
    desc: 'Пройти испытание в конце недели',
    glyph: '🛡️',
    target: 1,
    progress: (c) => (c.bossPassed ? 1 : 0),
  },
];

/** Три миссии на день — детерминированно по номеру дня программы. */
export function missionsForDay(dayIndex: number): MissionDef[] {
  const day = dayIndex % 5; // 0..4 — день внутри недели
  // Миссии за участие. «Серия ×5» и «Без промахов» заменены: см. комментарий в MISSIONS.
  const base = ['practice5', 'tries3', 'helper', 'warmup', 'stars2'];
  const picked: MissionDef[] = [];
  const offset = (dayIndex * 2) % base.length;
  for (let i = 0; i < base.length && picked.length < 3; i++) {
    const def = MISSIONS.find((m) => m.id === base[(offset + i) % base.length]);
    if (def && !picked.some((p) => p.id === def.id)) picked.push(def);
  }
  if (day === 4) {
    picked.pop();
    picked.push(MISSIONS.find((m) => m.id === 'boss')!);
  }
  if (dayIndex % 7 === 6) {
    if (!picked.some((p) => p.id === 'dayDone')) {
      picked[picked.length - 1] = MISSIONS.find((m) => m.id === 'dayDone')!;
    }
  }
  return picked;
}

/* ------------------------------- гардероб ------------------------------ */

export type ShopSlot = 'head' | 'body' | 'pet' | 'room';

export type ShopItem = {
  id: string;
  name: string;
  slot: ShopSlot;
  price: number;
  desc: string;
  /** как предмет выглядит в SVG */
  variant: string;
};

export const SHOP: ShopItem[] = [
  { id: 'head_cap', name: 'Кепка', slot: 'head', price: 40, desc: 'Классическая кепка', variant: 'cap' },
  { id: 'head_bandana', name: 'Бандана', slot: 'head', price: 35, desc: 'Для самых быстрых', variant: 'bandana' },
  { id: 'head_glasses', name: 'Очки', slot: 'head', price: 60, desc: 'Очки умника', variant: 'glasses' },
  { id: 'head_headphones', name: 'Наушники', slot: 'head', price: 90, desc: 'Полная тишина в голове', variant: 'headphones' },
  { id: 'head_crown', name: 'Корона', slot: 'head', price: 140, desc: 'Корона мастера мысли', variant: 'crown' },
  { id: 'body_scarf', name: 'Шарф', slot: 'body', price: 30, desc: 'Тёплый и смешной', variant: 'scarf' },
  { id: 'body_backpack', name: 'Рюкзак', slot: 'body', price: 55, desc: 'Всё нужное с собой', variant: 'backpack' },
  { id: 'body_super', name: 'Суперкостюм', slot: 'body', price: 110, desc: 'Герой района', variant: 'super' },
  { id: 'body_vest', name: 'Жилет', slot: 'body', price: 70, desc: 'Разведчик мысли', variant: 'vest' },
  { id: 'pet_cat', name: 'Котёнок Мур', slot: 'pet', price: 80, desc: 'Мур всегда рядом', variant: 'cat' },
  { id: 'pet_dragon', name: 'Дракончик Искра', slot: 'pet', price: 160, desc: 'Дышит огнём, когда радуется', variant: 'dragon' },
  { id: 'room_rug', name: 'Ковёр', slot: 'room', price: 35, desc: 'Мягко под ногами', variant: 'rug' },
  { id: 'room_lamp', name: 'Лампа', slot: 'room', price: 45, desc: 'Свет для мыслей', variant: 'lamp' },
  { id: 'room_poster', name: 'Плакат', slot: 'room', price: 25, desc: 'Карта района', variant: 'poster' },
  { id: 'room_plant', name: 'Растение', slot: 'room', price: 50, desc: 'Растёт вместе с тобой', variant: 'plant' },
];

export const SHOP_BY_ID = Object.fromEntries(SHOP.map((i) => [i.id, i]));

/** id предмета → вариант отрисовки (для SVG-персонажа). */
export function accessoryVariantOf(id: string | null): string | null {
  if (!id) return null;
  const item = SHOP.find((i) => i.id === id);
  return item && item.slot === 'head' ? item.variant : null;
}

export function bodyVariantOf(id: string | null): string | null {
  if (!id) return null;
  const item = SHOP.find((i) => i.id === id);
  return item && item.slot === 'body' ? item.variant : null;
}

export function petVariantOf(id: string | null): 'cat' | 'dragon' | null {
  if (!id) return null;
  const item = SHOP.find((i) => i.id === id);
  return item && item.slot === 'pet' ? (item.variant as 'cat' | 'dragon') : null;
}

/* ------------------------------ состояние ------------------------------ */

export function emptyStats(): PlayerStats {
  return {
    days: 0,
    tasks: 0,
    correctTasks: 0,
    scenarios: 0,
    goodScenarios: 0,
    bestCombo: 0,
    perfectDays: 0,
    minutes: 0,
  };
}

export function todayKey(ts = Date.now(), zone = DEFAULT_TIME_ZONE): string {
  return calendarDay(ts, zone);
}

export function dayOfWeek(ts = Date.now(), zone = DEFAULT_TIME_ZONE): number {
  return (new Date(`${todayKey(ts, zone)}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export type RewardBundle = {
  xp: number;
  coins: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
};

/** Пересчёт значков: возвращает ids новых значков и начисляет за них монетки. */
export function checkBadges(
  player: PlayerState,
  ctx: Omit<BadgeCtx, 'badges'> & { badges?: string[] }
): { newBadges: string[]; coins: number } {
  const full: BadgeCtx = { ...ctx, badges: player.badges };
  const newBadges: string[] = [];
  let coins = 0;
  for (const badge of BADGES) {
    if (player.badges.includes(badge.id)) continue;
    let ok = false;
    try {
      ok = badge.check(full);
    } catch {
      ok = false;
    }
    if (ok) {
      newBadges.push(badge.id);
      coins += COINS.badge;
    }
  }
  return { newBadges, coins };
}

export function applyBadgeGain(player: PlayerState, newBadges: string[], coins: number): void {
  player.badges = [...player.badges, ...newBadges];
  player.coins += coins;
}

/** Начисление опыта и монет с проверкой повышения уровня. */
export function grant(player: PlayerState, xp: number, coins: number): RewardBundle {
  const before = levelOf(player.xp);
  player.xp += xp;
  player.coins += coins;
  const after = levelOf(player.xp);
  return {
    xp,
    coins,
    newBadges: [],
    levelUp: after.level > before.level ? { level: after.level, title: after.title } : null,
  };
}
