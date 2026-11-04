/**
 * Начисление наград: опыт, монетки, звёзды, серии, значки, миссии.
 * Вся игровая логика живёт здесь, чтобы движок сессии оставался тонким.
 */
import { store } from '../store.ts';
import {
  BADGES,
  COINS,
  MISSIONS,
  XP,
  applyBadgeGain,
  checkBadges,
  grant,
  missionsForDay,
  starsForDay,
  type MissionDef,
} from '../gamification.ts';
import type { PlayerState, WeeklyReport } from '../types.ts';

export type MissionView = {
  id: string;
  title: string;
  desc: string;
  glyph: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
};

/** Приводим миссии игрока в соответствие с текущим днём программы. */
export function ensureMissions(player: PlayerState, dayIndex: number): { count: number; xp: number; coins: number } {
  const claimed = { count: 0, xp: 0, coins: 0 };
  if (player.missions.day === dayIndex && player.missions.ids.length > 0) return claimed;
  // Do not discard a completed but unclaimed mission when starting the next day.
  for (const mission of missionViews(player)) {
    if (!mission.done || mission.claimed) continue;
    const reward = claimMission(player, mission.id);
    if (reward) { claimed.count++; claimed.xp += reward.xp; claimed.coins += reward.coins; }
  }
  const defs = missionsForDay(dayIndex);
  player.missions = {
    day: dayIndex,
    ids: defs.map((d) => d.id),
    progress: Object.fromEntries(defs.map((d) => [d.id, 0])),
    claimed: [],
  };
  return claimed;
}

export function missionDefs(player: PlayerState): MissionDef[] {
  return player.missions.ids
    .map((id) => MISSIONS.find((m) => m.id === id))
    .filter((m): m is MissionDef => Boolean(m));
}

export function missionViews(player: PlayerState): MissionView[] {
  return missionDefs(player).map((m) => {
    const progress = Math.min(m.target, player.missions.progress[m.id] ?? 0);
    return {
      id: m.id,
      title: m.title,
      desc: m.desc,
      glyph: m.glyph,
      target: m.target,
      progress,
      done: progress >= m.target,
      claimed: player.missions.claimed.includes(m.id),
    };
  });
}

/** Обновляет прогресс миссий по текущему контексту дня. */
export function refreshMissions(
  player: PlayerState,
  ctx: {
    dayIndex: number;
    tasksDone: number;
    comboBest: number;
    correctStreak: number;
    goodChoice: boolean;
    perfectDay: boolean;
    bossPassed: boolean;
    stars: number;
  }
): void {
  ensureMissions(player, ctx.dayIndex);
  for (const def of missionDefs(player)) {
    const value = Math.min(def.target, def.progress(ctx));
    const prev = player.missions.progress[def.id] ?? 0;
    if (value > prev) player.missions.progress[def.id] = value;
  }
}

/** Контекст для проверки значков. */
export function badgeCtx(profileId: string, weekDone: number, currentPlayer?: PlayerState, context: Pick<typeof store, 'skills' | 'playerState'> = store) {
  const skills = context.skills(profileId).map((s) => ({ skill: s.skill, ability: s.ability }));
  const player = currentPlayer ?? context.playerState(profileId);
  return {
    stats: player.stats,
    weekDone,
    perfectDays: player.stats.perfectDays,
    inventory: player.inventory,
    skills,
  };
}

/** Проверяет значки и начисляет за них монетки. Возвращает ids новых значков. */
export function syncBadges(player: PlayerState, weekDone: number, context: Pick<typeof store, 'skills' | 'playerState'> = store): string[] {
  const ctx = badgeCtx(player.profileId, weekDone, player, context);
  const { newBadges, coins } = checkBadges(player, ctx);
  if (newBadges.length) applyBadgeGain(player, newBadges, coins);
  return newBadges;
}

export type EarnResult = {
  xp: number;
  coins: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
};

/** Награда за когнитивное задание. */
export function earnTask(player: PlayerState, correct: boolean, _combo: number): EarnResult {
  // Без бонуса за серию: верный ответ по-прежнему даёт больше неверного, но
  // «непрерывность без ошибок» больше не оплачивается отдельно.
  const xp = correct ? XP.taskCorrect : XP.taskWrong;
  const coins = correct ? COINS.taskCorrect : COINS.taskWrong;
  const res = grant(player, xp, coins);
  player.stats.tasks += 1;
  if (correct) player.stats.correctTasks += 1;
  return res;
}

/** Награда за участие в истории одинакова при любом выборе. */
export function earnScenario(
  player: PlayerState,
  _quality?: 'good' | 'partial' | 'bad'
): EarnResult {
  const res = grant(player, XP.scenarioGood, COINS.scenarioGood);
  player.stats.scenarios += 1;
  return res;
}

/** Fixed participation reward; choices do not score the child or affect skills. */
export function earnSupportPractice(player: PlayerState): EarnResult {
  return grant(player, 15, 5);
}

/** Завершение дня: звёзды, статистика и бонусы; поля legacy-серии не меняются. */
export function completeDay(
  player: PlayerState,
  info: {
    tasks: number;
    correct: number;
    /** quality is accepted for legacy callers; no judgment is made. */
    quality?: 'good' | 'partial' | 'bad';
    scenarioCompleted?: boolean;
    seconds: number;
    isBoss: boolean;
    dayIndex: number;
    weekDone: number;
    comboBest: number;
    correctStreak: number;
    timeZone?: string;
  },
  context: Pick<typeof store, 'skills' | 'playerState'> = store
): {
  stars: number;
  xp: number;
  coins: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
} {
  const stars = starsForDay(info.tasks, info.correct);
  // Исторический счётчик «дней без ошибок» сохраняем для старых отчётов и выгрузки,
  // но он больше ничего не оплачивает и не выдаёт значков.
  const perfect = info.tasks > 0 && info.correct === info.tasks;

  // Завершение дня оплачивается одинаково. Бонус за «день без ошибок» убран:
  // звёзды остаются отметкой, но не превращаются в доход.
  let xp = XP.dayComplete;
  let coins = 0;
  if (info.isBoss) xp += XP.bossComplete;

  const res = grant(player, xp, coins);
  player.stars += stars;
  player.stats.days += 1;
  player.stats.minutes += Math.round(info.seconds / 60);
  if (perfect) player.stats.perfectDays += 1;

  refreshMissions(player, {
    dayIndex: info.dayIndex,
    tasksDone: info.tasks,
    comboBest: info.comboBest,
    correctStreak: info.correctStreak,
    goodChoice: info.scenarioCompleted ?? (info.quality !== undefined),
    perfectDay: perfect,
    bossPassed: info.isBoss,
    stars,
  });

  const newBadges = syncBadges(player, info.weekDone, context);
  return {
    stars,
    xp: res.xp,
    coins: res.coins,
    newBadges,
    levelUp: res.levelUp,
  };
}

/** Клик по готовой миссии: забрать награду. */
export function claimMission(player: PlayerState, missionId: string): EarnResult | null {
  const views = missionViews(player);
  const view = views.find((v) => v.id === missionId);
  if (!view || !view.done || view.claimed) return null;
  player.missions.claimed.push(missionId);
  const res = grant(player, XP.mission, COINS.mission);
  return res;
}

/** Покупка предмета гардероба за игровые монетки. */
export function buyItem(
  player: PlayerState,
  itemId: string,
  price: number
): { ok: boolean; error?: string } {
  if (player.inventory.includes(itemId)) return { ok: false, error: 'already_owned' };
  if (player.coins < price) return { ok: false, error: 'not_enough_coins' };
  player.coins -= price;
  player.inventory.push(itemId);
  return { ok: true };
}

/** Итоговый блок для отчёта родителю. */
export function playerReportBlock(player: PlayerState, levelTitle: string): WeeklyReport['player'] {
  return {
    level: 0,
    levelTitle,
    xp: player.xp,
    coins: player.coins,
    stars: player.stars,
    badges: player.badges.length,
    days: player.stats.days,
    perfectDays: player.stats.perfectDays,
  };
}

export { BADGES };
