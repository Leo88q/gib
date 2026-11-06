import type { Profile } from '../types';

/**
 * Общая семейная цель.
 *
 * Считаем только подтверждённые семейные отметки профилей одного владельца.
 * Это не рейтинг детей: результат — одно число на всю семью, без разбивки по
 * профилям и без сравнения. Вклады отдельных профилей наружу не отдаются,
 * чтобы нельзя было устроить соревнование братьев и сестёр и чтобы вклад
 * одного ребёнка не становился видимым другому.
 */

export const FAMILY_GOAL_TARGET = 12;
/** Допустимые размеры цели: семья сама решает, сколько отметок ей хочется. */
export const FAMILY_GOAL_MIN = 4;
export const FAMILY_GOAL_MAX = 60;
/** Шаг изменения — 4 отметки: не превращаем настройку в соревнование на десятки. */
export const FAMILY_GOAL_STEP = 4;

export function validGoalTarget(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= FAMILY_GOAL_MIN
    && value <= FAMILY_GOAL_MAX
    && value % FAMILY_GOAL_STEP === 0;
}

export type FamilyGoalProfile = { profileId: string; confirmed: number };

export type FamilyGoal = {
  /** Подтверждённые отметки всей семьи, без разбивки по профилям. */
  confirmed: number;
  target: number;
  /** Сколько профилей участвует — только для пояснения, без имён. */
  members: number;
  reached: boolean;
};

/** Отметки сверх цели не теряются: ребёнок может продолжать без «перевыполнения». */
export function familyGoal(
  profiles: Pick<Profile, 'id'>[],
  confirmedByProfile: Map<string, number>,
  target: number = FAMILY_GOAL_TARGET,
): FamilyGoal {
  let confirmed = 0;
  let members = 0;
  for (const profile of profiles) {
    const value = confirmedByProfile.get(profile.id);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      confirmed += Math.floor(value);
      members += 1;
    }
  }
  const safeTarget = validGoalTarget(target) ? target : FAMILY_GOAL_TARGET;
  // Цель семьи не рейтинг: достигнутая цель не отнимает уже накопленные отметки.
  return { confirmed, target: safeTarget, members, reached: confirmed >= safeTarget };
}

/**
 * Текст прогресса для ребёнка и родителя. Без «молодец, ты лучше» и без
 * обещаний: только факт и приглашение, от которого можно отказаться.
 */
export function familyGoalNotice(goal: FamilyGoal): string {
  if (goal.reached) return `Семейная цель выполнена: ${goal.confirmed} отметок. Можно продолжать, если хочется.`;
  const left = goal.target - goal.confirmed;
  if (goal.confirmed === 0) return `Общая цель семьи — ${goal.target} совместных отметок. Начать можно когда угодно.`;
  return `Общая цель семьи: ${goal.confirmed} из ${goal.target}. Осталось ${left} — если захочется.`;
}
