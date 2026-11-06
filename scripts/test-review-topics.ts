import assert from 'node:assert/strict';
import { reviewStatesFromSessions, dueReviewTopics, reviewTopicFor, reviewNotice, reviewDayKeyFor, MAX_REVIEW_TOPICS } from '../lib/review/topics';
import { applyReview, MAX_REVIEWS } from '../lib/review/intervals';
import type { Session } from '../lib/types';
import { SCENARIO_BY_ID } from '../lib/content/program/index';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
const ALL = { ...SCENARIO_BY_ID, ...STORYLETS_BY_ID } as Record<string, any>;

/**
 * Повторение как часть дня: темы берутся из завершённых занятий, срок считается
 * по возрасту, ничего не назначается принудительно и не оценивает ребёнка.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const finished = (scenarioId: string, finishedAt: number): Session => ({
  id: 's_' + scenarioId + '_' + finishedAt, profileId: 'p1', startedAt: finishedAt - 600_000, finishedAt,
  seconds: 600, tasks: [], plan: [], scenario: { scenarioId, competency: 'empathy', choice: 0 },
} as unknown as Session);

/* ------------------ 1. темы берутся только из завершённых ------------------ */
{
  const open: Session = { ...finished('w1d1_music', NOW - 3 * DAY), finishedAt: undefined } as unknown as Session;
  const states = reviewStatesFromSessions([finished('w1d1_music', NOW - 3 * DAY), open], '8-10', NOW);
  assert.equal(states.length, 1, 'незавершённая сессия не создаёт тему повторения');
  const topic = reviewTopicFor(states[0].topicId, '8-10');
  assert.ok(topic, 'тема находится в каталоге');
  assert.equal(topic!.competency, ALL['w1d1_music'].competency);
  assert.ok(topic!.title.length > 0);
  // Неизвестный сценарий не выдумывает тему.
  assert.equal(reviewTopicFor('not-a-scenario', '8-10'), null);
}

/* --------------------- 2. срок повторения по возрасту --------------------- */
{
  const byBand: Record<string, number> = {};
  for (const band of ['5-7', '8-10', '11-13'] as const) {
    const states = reviewStatesFromSessions([finished('w1d1_music', NOW - DAY)], band, NOW);
    byBand[band] = Math.round((states[0].dueAt! - (NOW - DAY)) / DAY);
    assert.ok(byBand[band] > 0, `${band}: срок в будущем`);
  }
  assert.ok(byBand['5-7'] < byBand['8-10'] && byBand['8-10'] < byBand['11-13'], 'младшие повторяют раньше');
  // Сразу после прохождения повтор не показывается.
  const fresh = reviewStatesFromSessions([finished('w1d1_music', NOW - 60_000)], '8-10', NOW);
  assert.equal(dueReviewTopics(fresh, '8-10', NOW, 1).length, 0, 'свежая тема не повторяется сразу');
  // Когда срок наступил — показывается ровно одна тема.
  const dueStates = reviewStatesFromSessions([finished('w1d1_music', NOW - 10 * DAY)], '8-10', NOW);
  const due = dueReviewTopics(dueStates, '8-10', NOW, 1);
  assert.equal(due.length, 1);
  assert.equal(due[0].scenarioId, 'w1d1_music');
}

/* ------------- 3. сохранённое состояние не перетирается сессиями ------------- */
{
  const existing = [{ topicId: 'w1d1_music', band: '8-10' as const, reviews: 2, dueAt: NOW + 5 * DAY, skipped: 1, updatedAt: NOW }];
  const states = reviewStatesFromSessions([finished('w1d1_music', NOW - 20 * DAY)], '8-10', NOW, existing);
  assert.equal(states.length, 1);
  assert.equal(states[0].dueAt, NOW + 5 * DAY, 'сохранённый срок не пересчитывается');
  assert.equal(states[0].reviews, 2);
  assert.equal(states[0].skipped, 1);
}

/* --------------------------- 4. пределы и порядок --------------------------- */
{
  const ids = Object.keys(ALL).slice(0, 20);
  const sessions = ids.map((id, i) => finished(id, NOW - (i + 1) * DAY));
  const states = reviewStatesFromSessions(sessions, '8-10', NOW);
  assert.ok(states.length <= MAX_REVIEW_TOPICS, 'число тем ограничено');
  const dues = states.map(s => s.dueAt ?? Infinity);
  assert.deepEqual(dues, [...dues].sort((a, b) => a - b), 'темы отсортированы по сроку');
  const topics = dueReviewTopics(states, '8-10', NOW + 100 * DAY, 5);
  assert.ok(topics.every(t => Boolean(ALL[t.scenarioId])), 'в выдаче только существующие сценарии');
}

/* -------------------------- 5. формулировки без оценок -------------------------- */
{
  const topic = reviewTopicFor('w1d1_music', '5-7')!;
  for (const band of ['5-7', '8-10', '11-13'] as const) {
    const notice = reviewNotice(topic, band);
    assert.ok(notice.forChild.includes(topic.title), 'ребёнок видит свою тему');
    assert.ok(/можно|пропусти|без спешки|в порядке/i.test(notice.forChild), 'нет принуждения');
    assert.ok(!/должен|обязан|слаб|плохо|отстаёт|уровень|диагноз|оценк/i.test(notice.forChild + notice.forParent), 'нет оценочных слов');
    assert.match(notice.forParent, /не суждение|ничего не отменяет/, 'родителю объяснено, что это расписание');
  }
}

/* -------------------- 6. ключ дня по часовому поясу профиля -------------------- */
{
  const at = Date.UTC(2026, 0, 1, 21, 30); // 00:30 по Москве, ещё 1 января по UTC
  // Пояс профиля, а не UTC: иначе около полуночи появлялся бы «новый день».
  assert.equal(reviewDayKeyFor({ timeZone: 'Europe/Moscow' }, at), '2026-01-02', 'в Москве уже следующий день');
  assert.equal(reviewDayKeyFor({ timeZone: 'Asia/Vladivostok' }, at), '2026-01-02');
  // Калининград — UTC+2: в 21:30 UTC там ещё 1 января, а в 22:30 — уже 2-е.
  assert.equal(reviewDayKeyFor({ timeZone: 'Europe/Kaliningrad' }, Date.UTC(2026, 0, 1, 21, 30)), '2026-01-01', 'в Калининграде ещё прошлый день');
  assert.equal(reviewDayKeyFor({ timeZone: 'Europe/Kaliningrad' }, Date.UTC(2026, 0, 1, 22, 30)), '2026-01-02');
  // Неизвестный или пустой пояс не ломает правило: берётся пояс по умолчанию.
  assert.match(reviewDayKeyFor({}, at), /^\d{4}-\d{2}-\d{2}$/);
}

/* ------------ 7. полный цикл: срок → повтор → новый срок ------------ */
{
  const before = reviewStatesFromSessions([finished('w1d1_music', NOW - 20 * DAY)], '8-10', NOW)[0];
  assert.equal(before.reviews, 0, 'тема ещё не повторялась');
  const next = applyReview(before, 'reviewed', NOW);
  assert.ok(next.ok);
  assert.ok((next.state.dueAt ?? 0) > NOW, 'после повтора срок сдвинулся');
  assert.equal(next.state.reviews, 1);
  assert.ok(next.state.reviews < MAX_REVIEWS);
}

console.log('  ok повторение тем: только завершённые, возрастной срок, сохранённое состояние, формулировки без оценок');
