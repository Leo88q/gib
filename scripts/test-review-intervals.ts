import assert from 'node:assert/strict';
import { applyReview, describeReview, dueTopics, MAX_REVIEW_DAYS, MAX_REVIEWS, type ReviewState } from '../lib/review/intervals';

/**
 * Правила повторения: короткие интервалы для младших, ограниченный рост,
 * пропуск и отказ ничего не наказывают, срок объясняется словами.
 * Это расписание, а не оценка ребёнка.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const base = (band: ReviewState['band']): ReviewState => ({ topicId: 'w1d1', band, reviews: 0, dueAt: null, skipped: 0, updatedAt: NOW });

/* --------------------------- 1. рост интервала --------------------------- */
{
  const intervals: Record<string, number[]> = {};
  for (const band of ['5-7', '8-10', '11-13'] as const) {
    let state = base(band);
    const days: number[] = [];
    for (let i = 0; i < MAX_REVIEWS; i++) {
      const next = applyReview(state, 'reviewed', NOW);
      assert.ok(next.ok);
      state = next.state;
      days.push(state.dueAt === null ? 0 : Math.round((state.dueAt - NOW) / DAY));
    }
    intervals[band] = days;
    // После предела повторов тема закреплена: dueAt = null.
    assert.equal(state.dueAt, null, `${band}: после ${MAX_REVIEWS} повторов тема закреплена`);
    assert.equal(state.reviews, MAX_REVIEWS);
  }
  // Младший возраст повторяет раньше, старший — позже, и интервалы не убывают.
  assert.ok(intervals['5-7'][0] < intervals['8-10'][0] && intervals['8-10'][0] < intervals['11-13'][0], 'возрастные интервалы различаются');
  for (const band of Object.keys(intervals)) {
    const days = intervals[band].filter(d => d > 0);
    assert.ok(days.every((d, i) => i === 0 || d >= days[i - 1]), `${band}: интервал не уменьшается`);
    assert.ok(days.every(d => d <= MAX_REVIEW_DAYS), `${band}: интервал не больше предела`);
  }
}

/* ---------------------- 2. пропуск и отказ не наказывают ---------------------- */
{
  const state = { ...base('8-10'), dueAt: NOW, reviews: 2 };
  const skipped = applyReview(state, 'skipped', NOW);
  assert.ok(skipped.ok);
  assert.equal(skipped.state.dueAt, NOW, 'пропуск не сдвигает срок вперёд');
  assert.equal(skipped.state.reviews, 2, 'пропуск не сбрасывает прогресс');
  assert.equal(skipped.state.skipped, 1, 'пропуск учитывается только как факт');

  const refused = applyReview(state, 'refused', NOW);
  assert.ok(refused.ok);
  assert.equal(refused.state.dueAt, null, 'после отказа тема не висит в списке');
  assert.equal(refused.state.reviews, 2, 'отказ не уменьшает прогресс');

  // Неизвестный результат и испорченное состояние отклоняются без исключения.
  assert.deepEqual(applyReview(state, 'later' as any, NOW), { ok: false, error: 'unknown_outcome' });
  assert.deepEqual(applyReview({ ...state, reviews: -1 }, 'reviewed', NOW), { ok: false, error: 'invalid_state' });
  assert.deepEqual(applyReview(state, 'reviewed', Number.NaN), { ok: false, error: 'invalid_state' });
}

/* ------------------------- 3. объяснение срока ------------------------- */
{
  assert.match(describeReview({ ...base('5-7'), dueAt: NOW + DAY }, NOW), /завтра/);
  assert.match(describeReview({ ...base('5-7'), dueAt: NOW + 3 * DAY }, NOW), /через 3 дня/);
  assert.match(describeReview({ ...base('5-7'), dueAt: NOW + 5 * DAY }, NOW), /через 5 дней/);
  assert.match(describeReview({ ...base('5-7'), dueAt: NOW + 11 * DAY }, NOW), /через 11 дней/);
  assert.match(describeReview({ ...base('5-7'), dueAt: NOW + 21 * DAY }, NOW), /через 21 день/);
  const capped = describeReview({ ...base('8-10'), reviews: MAX_REVIEWS, dueAt: null }, NOW);
  assert.match(capped, /закреплена/);
  // Текст — расписание, а не вывод о ребёнке.
  assert.ok(!/успевает|отстаёт|способн|уровень|диагноз/.test(capped));
}

/* ------------------------------ 4. выборка ------------------------------ */
{
  const states: ReviewState[] = [
    { ...base('8-10'), topicId: 'later', dueAt: NOW + DAY },
    { ...base('8-10'), topicId: 'soon', dueAt: NOW - DAY },
    { ...base('8-10'), topicId: 'now', dueAt: NOW },
    { ...base('8-10'), topicId: 'closed', reviews: MAX_REVIEWS, dueAt: null },
  ];
  const due = dueTopics(states, NOW, 5);
  assert.deepEqual(due.map(s => s.topicId), ['soon', 'now'], 'просроченные раньше, закрытые не показываются');
  assert.equal(dueTopics(states, NOW, 1).length, 1, 'ограничение списка работает');
}

console.log('  ok повторение: возрастные интервалы, предел, пропуск и отказ без наказания, срок словами');
