import assert from 'node:assert/strict';
import { activityHistory, activitySummary, activityDayLabel, HISTORY_DAYS } from '../lib/engine/activity-history';
import { calendarDay, shiftDay } from '../lib/calendar';
import type { Session } from '../lib/types';

const profile = { id: 'p1', timeZone: 'Europe/Moscow' };
const now = Date.UTC(2026, 10, 4, 12, 0, 0); // 4 ноября 2026, 15:00 МСК
const today = calendarDay(now, 'Europe/Moscow');

const session = (daysAgo: number, extra: Partial<Session> = {}, profileId = 'p1'): Session => ({
  id: `s${daysAgo}-${Math.random()}`,
  profileId,
  startedAt: now - daysAgo * 86_400_000 - 3_600_000,
  finishedAt: now - daysAgo * 86_400_000,
  seconds: 300,
  tasks: [],
  plan: [],
  ...extra,
});

// 1. Форма истории: ровно 28 дней, последний — сегодня, без пропусков календаря.
{
  const history = activityHistory(profile, [], now);
  assert.equal(history.length, HISTORY_DAYS);
  assert.equal(history.at(-1)!.day, today, 'последний день — сегодня');
  assert.equal(history[0].day, shiftDay(today, -(HISTORY_DAYS - 1)), 'первый день — 27 дней назад');
  assert.equal(new Set(history.map(d => d.day)).size, HISTORY_DAYS, 'дни не повторяются');
  assert.ok(history.every(d => d.sessions === 0), 'без занятий всё пусто');
}

// 2. Считаются только завершённые занятия этого профиля.
{
  const history = activityHistory(profile, [
    session(0),
    session(0, {}, 'p2'), // чужой профиль
    session(2, { finishedAt: undefined }), // незавершённая
    session(2, { finishedAt: 0 }), // испорченная метка
  ], now);
  assert.equal(history.at(-1)!.sessions, 1, 'сегодняшнее занятие');
  assert.equal(history.at(-3)!.sessions, 0, 'незавершённые и чужие не считаются');
}

// 3. Несколько занятий в один день складываются.
{
  const history = activityHistory(profile, [session(1), session(1), session(1, { review: { topicId: 't' } })], now);
  const day = history.at(-2)!;
  assert.equal(day.sessions, 3);
  assert.equal(day.reviewOnly, false, 'был новый день, значит не только повтор');
}

// 4. День из одних повторов помечается отдельно.
{
  const history = activityHistory(profile, [session(1, { review: { topicId: 'topic' } })], now);
  const day = history.at(-2)!;
  assert.equal(day.sessions, 1);
  assert.equal(day.reviewOnly, true);
}

// 5. Занятия старше 28 дней не попадают в историю.
{
  const history = activityHistory(profile, [session(HISTORY_DAYS), session(HISTORY_DAYS + 5)], now);
  assert.ok(history.every(d => d.sessions === 0), 'старые занятия не показываются');
}

// 6. Часовой пояс: занятие поздно вечером по UTC попадает на следующий день по Москве.
{
  // 21:30 UTC 3 ноября = 00:30 МСК 4 ноября.
  const late = { ...session(0), finishedAt: Date.UTC(2026, 10, 3, 21, 30, 0) };
  const msk = activityHistory(profile, [late], Date.UTC(2026, 10, 4, 6, 0, 0));
  assert.equal(msk.at(-1)!.day, '2026-11-04', 'по Москве это уже 4 ноября');
  assert.equal(msk.at(-1)!.sessions, 1, 'занятие попало в сегодняшний день');
}

// 7. Подпись не называет пропуски и не оценивает.
{
  const empty = activitySummary(activityHistory(profile, [], now));
  assert.equal(empty.activeDays, 0);
  assert.ok(!/пропуск|плохо|стыд|надо/i.test(empty.text), `пустая история без вины: ${empty.text}`);
  // Формулировка карты тоже не должна упоминать пропуски — это проверяет браузерный тест,
  // здесь держим инвариант для всех текстов истории.
  assert.ok(!/пропуск/i.test(activitySummary(activityHistory(profile, [session(0)], now)).text));
  assert.ok(empty.text.includes('когда угодно'), 'начать можно в любой момент');

  const some = activitySummary(activityHistory(profile, [session(0), session(3)], now));
  assert.equal(some.activeDays, 2);
  assert.ok(some.text.includes('2'), 'число дней занятий названо');
  assert.ok(some.text.includes('а не оценка'), 'прямо сказано, что это факт');
  assert.ok(!/пропуск/i.test(some.text), 'пропуски не упоминаются');
}

// 8. Подписи дней для диктора: без слова «пропуск».
{
  assert.equal(activityDayLabel({ day: '2026-11-04', sessions: 0, reviewOnly: false }), '2026-11-04: занятий не было');
  assert.equal(activityDayLabel({ day: '2026-11-04', sessions: 2, reviewOnly: false }), '2026-11-04: 2 занятий');
  assert.equal(activityDayLabel({ day: '2026-11-04', sessions: 1, reviewOnly: true }), '2026-11-04: повтор темы');
  for (const label of [
    activityDayLabel({ day: 'd', sessions: 0, reviewOnly: false }),
    activityDayLabel({ day: 'd', sessions: 3, reviewOnly: false }),
  ]) assert.ok(!/пропуск/i.test(label), 'слово «пропуск» не используется');
}

// 9. Занятие до начала периода не ломает раскладку.
{
  const history = activityHistory(profile, [session(400)], now, 7);
  assert.equal(history.length, 7);
  assert.ok(history.every(d => d.sessions === 0));
}

console.log('  ok история занятости: 28 дней, чужое и незавершённое не считается, повтор отдельно, без слов о пропусках');
