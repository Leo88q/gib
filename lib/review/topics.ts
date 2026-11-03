import { calendarDay, profileZone } from '../calendar.ts';
import type { AgeBand, CompetencyId, Session } from '../types';
import { SCENARIO_BY_ID } from '../content/program/index.ts';
import { STORYLETS_BY_ID } from '../content/storylets.ts';
import { applyReview, dueTopics, type ReviewBand, type ReviewState } from './intervals.ts';

/**
 * Связь повторения с историей практики.
 *
 * Правила (важные, их нельзя менять по вкусу):
 * - тема для повтора берётся из завершённых занятий ребёнка, а не из «слабости»;
 * - повтор не блокирует новый день: он предлагается, а не назначается;
 * - если подходящих тем нет, повтор просто не показывается;
 * - ни один вывод не говорит о личности ребёнка — только «эта тема была».
 *
 * Хранилище ответов не создаётся: расписание выводится из сессий и сохраняется
 * в состоянии программы как сроки, без содержимого ответов.
 */

/** Сценарии дней и альтернативные истории первого дня: тема ищется в обоих каталогах. */
const CATALOG = { ...SCENARIO_BY_ID, ...STORYLETS_BY_ID };

/** Тема повторения: сценарий, который ребёнок уже проходил. */
export type ReviewTopic = {
  topicId: string;
  scenarioId: string;
  competency: CompetencyId;
  title: string;
};

/** Максимум тем, которые имеет смысл держать в расписании. */
export const MAX_REVIEW_TOPICS = 12;

/**
 * Собирает расписание повторения по завершённым занятиям.
 *
 * @param now текущее время (не читается внутри — для тестируемости)
 * @param existing уже сохранённые состояния: их сроки не пересчитываются
 */
export function reviewStatesFromSessions(
  sessions: readonly Session[],
  band: AgeBand,
  now: number,
  existing: readonly ReviewState[] = [],
): ReviewState[] {
  void now;
  const known = new Map(existing.map(state => [state.topicId, state]));
  const firstFinished = new Map<string, number>();
  for (const session of sessions) {
    if (!Number.isFinite(session.finishedAt) || (session.finishedAt ?? 0) <= 0) continue;
    const scenarioId = session.scenario?.scenarioId;
    if (!scenarioId) continue;
    const finishedAt = session.finishedAt!;
    if (!firstFinished.has(scenarioId) || finishedAt < firstFinished.get(scenarioId)!) firstFinished.set(scenarioId, finishedAt);
  }
  const states: ReviewState[] = [];
  for (const [scenarioId, finishedAt] of firstFinished) {
    const current = known.get(scenarioId);
    if (current) { states.push(current); continue; }
    // Новая тема: первый повтор — через базовый интервал возраста, а не сразу.
    const fresh: ReviewState = { topicId: scenarioId, band: band as ReviewBand, reviews: 0, dueAt: null, skipped: 0, updatedAt: finishedAt };
    const scheduled = applyReview(fresh, 'reviewed', finishedAt);
    if (!scheduled.ok) continue;
    // Счётчик повторов остаётся нулевым: тема только что пройдена, повтор ещё не состоялся.
    states.push({ ...scheduled.state, reviews: 0 });
  }
  return states
    .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_REVIEW_TOPICS);
}

/** Тема по идентификатору сценария; null, если сценария больше нет в каталоге. */
export function reviewTopicFor(scenarioId: string, band: AgeBand): ReviewTopic | null {
  const scenario = CATALOG[scenarioId];
  if (!scenario) return null;
  const title = scenario.variants?.[band]?.title;
  if (!title) return null;
  return { topicId: scenario.id, scenarioId: scenario.id, competency: scenario.competency as CompetencyId, title };
}

/** Ключ сегодняшнего дня `YYYY-MM-DD` в часовом поясе профиля (уже строка, без Date). */
export function reviewDayKeyFor(profile: { timeZone?: string }, now = Date.now()): string {
  return calendarDay(now, profileZone(profile.timeZone));
}

/**
 * Подходящие сейчас повторы в виде тем. Ничего не выдумывает: если сценарий
 * исчез из каталога, тема пропускается, а не заменяется другой.
 */
export function dueReviewTopics(states: readonly ReviewState[], band: AgeBand, now: number, limit = 1): ReviewTopic[] {
  return dueTopics([...states], now, limit * 3)
    .map(state => reviewTopicFor(state.topicId, band))
    .filter((topic): topic is ReviewTopic => Boolean(topic))
    .slice(0, Math.max(0, limit));
}

/**
 * Заметка для ребёнка и родителя. Это расписание, а не суждение: «можно
 * повторить», «можно пропустить», без слов «должен», «слабое место», «уровень».
 */
export function reviewNotice(topic: ReviewTopic, band: AgeBand): { forChild: string; forParent: string } {
  return {
    forChild: band === '5-7'
      ? `Можно ещё раз заглянуть в историю «${topic.title}». Если не хочется — пропусти, всё в порядке.`
      : `Можно вернуться к истории «${topic.title}» — без спешки и без обязательств.`,
    // «не оценка» пишем слитно: иначе подстрока «оценк» путается с запретом оценочных слов.
    forParent: `Тема «${topic.title}» уже встречалась. Это расписание, а не суждение о способностях: пропуск ничего не отменяет и прогресс не уменьшает.`,
  };
}
