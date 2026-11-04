import { calendarDay, profileZone, shiftDay } from '../calendar';
import type { Profile, Session } from '../types';

/**
 * Занятость по дням — «активности иных дней» для карты практики.
 *
 * Показываем только факт: в этот день были завершённые занятия или нет.
 * Ни ответов, ни чувств, ни оценок, ни серий: карта не должна превращаться в
 * таблицу успеваемости и не должна вызывать вину за пропуски. Пропуск дня
 * просто остаётся пустым — без цвета «плохо» и без предупреждений.
 */

export const HISTORY_DAYS = 28;

export type ActivityDay = {
  /** Календарный день `YYYY-MM-DD` в часовом поясе профиля. */
  day: string;
  /** Сколько завершённых занятий было в этот день (0 — не занимался). */
  sessions: number;
  /** Был ли повтор темы — только чтобы отличить его от нового дня. */
  reviewOnly: boolean;
};

export function activityHistory(profile: Pick<Profile, 'id' | 'timeZone'>, sessions: readonly Session[], now = Date.now(), days = HISTORY_DAYS): ActivityDay[] {
  const zone = profileZone(profile.timeZone);
  const today = calendarDay(now, zone);
  const byDay = new Map<string, { sessions: number; reviewOnly: boolean }>();
  const result: ActivityDay[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    byDay.set(day, { sessions: 0, reviewOnly: true });
  }

  for (const session of sessions) {
    if (session.profileId !== profile.id) continue;
    const finished = session.finishedAt;
    if (typeof finished !== 'number' || !Number.isFinite(finished) || finished <= 0) continue;
    const bucket = byDay.get(calendarDay(finished, zone));
    if (!bucket) continue;
    bucket.sessions += 1;
    // День считается «новым», если в нём была хотя бы одна сессия не-повтора.
    if (!session.review) bucket.reviewOnly = false;
  }

  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    const bucket = byDay.get(day)!;
    result.push({ day, sessions: bucket.sessions, reviewOnly: bucket.sessions > 0 && bucket.reviewOnly });
  }
  return result;
}

/** Короткая подпись для карты: только факты, без похвалы и упрёка. */
export function activitySummary(history: readonly ActivityDay[]): { activeDays: number; totalDays: number; text: string } {
  const activeDays = history.filter(d => d.sessions > 0).length;
  const totalDays = history.length;
  if (activeDays === 0) return { activeDays, totalDays, text: `За последние ${totalDays} дней занятий пока не было. Начать можно когда угодно.` };
  return { activeDays, totalDays, text: `За последние ${totalDays} дней занятия были в ${activeDays}. Это факт, а не оценка.` };
}

/**
 * Подпись дня для экранного диктора: «день, занятий», без слов «пропуск».
 */
export function activityDayLabel(day: ActivityDay): string {
  if (day.sessions === 0) return `${day.day}: занятий не было`;
  if (day.reviewOnly) return `${day.day}: повтор темы`;
  return `${day.day}: ${day.sessions} занятий`;
}
