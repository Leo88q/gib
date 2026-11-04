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
export function familyGoal(profiles: Pick<Profile, 'id'>[], confirmedByProfile: Map<string, number>): FamilyGoal {
  let confirmed = 0;
  let members = 0;
  for (const profile of profiles) {
    const value = confirmedByProfile.get(profile.id);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      confirmed += Math.floor(value);
      members += 1;
    }
  }
  return { confirmed, target: FAMILY_GOAL_TARGET, members, reached: confirmed >= FAMILY_GOAL_TARGET };
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
