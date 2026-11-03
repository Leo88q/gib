import { calendarDay, dayStart, isTimeZone, profileZone, shiftDay, TIME_ZONES, weekStartDay } from '../lib/calendar.ts';
function check(ok: unknown, text: string): asserts ok { if (!ok) throw Error(text); console.log('  ok', text); }
const mondayVlad = Date.parse('2026-10-25T14:00:00Z');
check(calendarDay(mondayVlad, 'Asia/Vladivostok') === '2026-10-26' && calendarDay(mondayVlad, 'Europe/Moscow') === '2026-10-25', 'дата зависит от часового пояса, а не сервера');
check(weekStartDay(mondayVlad, 'Asia/Vladivostok') === '2026-10-26', 'во Владивостоке уже понедельник');
check(weekStartDay(mondayVlad, 'Europe/Moscow') === '2026-10-19', 'в Москве ещё предыдущая неделя');
check(dayStart('2026-10-26', 'Asia/Vladivostok') === mondayVlad, 'начало недели в часовом поясе Владивостока');
check(dayStart('2026-10-26', 'Europe/Moscow') === Date.parse('2026-10-25T21:00:00Z'), 'начало недели в часовом поясе Москвы');
check(shiftDay('2024-03-01', -1) === '2024-02-29' && shiftDay('2027-01-01', -1) === '2026-12-31', 'границы месяца, високосного и нового года');
for (const zone of TIME_ZONES) {
  const day = calendarDay(mondayVlad, zone.id);
  check(calendarDay(dayStart(day, zone.id), zone.id) === day && calendarDay(dayStart(day, zone.id) - 1, zone.id) === shiftDay(day, -1), `${zone.label}: граница дня`);
}
check(!isTimeZone('UTC') && profileZone('bad') === 'Europe/Moscow', 'чужой часовой пояс отклоняется, старый профиль получает московский');
const { accuracyDelta, unassistedAccuracy } = await import('../lib/engine/report-math.ts');
check(accuracyDelta({ ok: 8, all: 10 }, { ok: 5, all: 10 }) === 30, 'рост 50% до 80% составляет 30 процентных пунктов');
check(accuracyDelta({ ok: 0, all: 3 }, { ok: 0, all: 2 }) === 0, 'настоящий нулевой сдвиг отличается от отсутствия данных');
check(accuracyDelta({ ok: 1, all: 2 }, undefined) === null && accuracyDelta({ ok: 0, all: 0 }, { ok: 0, all: 2 }) === null, 'нет сравнения без ответов в обеих неделях');

const samples = unassistedAccuracy([{ tasks: [
  { skill: 'working_memory', correct: true },
  { skill: 'working_memory', correct: false, assisted: true },
  { skill: 'attention', correct: true, assisted: true },
] }]);
check(samples.working_memory?.all === 1 && samples.working_memory.ok === 1 && !samples.attention, 'практика с подсказкой исключена из доли верных ответов, старые ответы сохранены');
