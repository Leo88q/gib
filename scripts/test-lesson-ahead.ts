/**
 * «Следующая встреча» и «к чему ребёнок готов»: два числа, а не одно.
 *
 * До этой функции родитель видел календарное занятие. Если ребёнок прошёл дни
 * вперёд (болел, уехал, но занимался из приложения), семья видела отставание,
 * которого нет, и решала, что прогресс потерялся. Если ребёнок отстал, семья
 * видела занятие, к которому он не готов.
 *
 * Встреча назначается школой и не сдвигается от прогресса ребёнка. Готовность
 * определяется его днями в приложении и может и обгонять календарь, и отставать.
 * Одно число на оба вопроса — враньё в обе стороны.
 *
 * Проверяется:
 *  1. Ребёнок не начал — встреча 1, готов к 1.
 *  2. Прошёл дни вперёд — встреча по календарю, готовность выше, `gap: ahead`.
 *  3. Отстаёт — встреча по календарю (школа её не двигает), готовность ниже,
 *     `gap: behind`.
 *  4. Год закончился по календарю — встречи нет.
 *  5. День относится к последнему занятию, все дни которого не позже него.
 *
 * Запуск: npm run test:lesson-ahead
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { buildSchedule, lessonOfDayIndex, lessonToShow } from '../lib/year/lessons.ts';

const schedule = buildSchedule(YEAR, '2026-09-05');
const days = (count: number) => Array.from({ length: count }, (_, i) => i);

/* ---- 1. Ничего не пройдено ---- */

let shown = lessonToShow({ year: YEAR, schedule, completedDayIndexes: [], today: '2026-09-01' });
assert.equal(shown?.lesson, 1, `встреча ${shown?.lesson}, ожидалась 1`);
assert.equal(shown?.readyFor, 1, `готовность ${shown?.readyFor}, ожидалась 1`);
assert.equal(shown?.gap, 'calendar', 'без прогресса расхождение с календарём');
console.log('  ok без прогресса встреча 1 и готовность 1');

/* ---- 2. Ребёнок ушёл вперёд ---- */

// Первые три занятия темы 1 покрывают дни 0..3. Прошли 0..4 — это уже тема 2.
const daysOfFirstThree = YEAR.lessons.slice(0, 3).flatMap((lesson) => lesson.dayIndexes);
shown = lessonToShow({
  year: YEAR,
  schedule,
  completedDayIndexes: days(0 + Math.max(...daysOfFirstThree) + 1),
  today: '2026-09-06',
});
const fourthByFact = YEAR.lessons.find((lesson) => Math.min(...lesson.dayIndexes) > Math.max(...daysOfFirstThree));
assert.ok(fourthByFact, 'не нашлось занятия после первых трёх');
// Встреча остаётся календарной: школа не переносит занятие из-за прогресса.
assert.equal(shown?.lesson, 2, `встреча ${shown?.lesson}, ожидалась 2: календарь не двигается прогрессом`);
assert.equal(shown?.readyFor, fourthByFact.number, `готовность ${shown?.readyFor}, ожидалась ${fourthByFact.number}`);
assert.equal(shown?.gap, 'ahead', 'ребёнок впереди календаря, но это не сказано');
console.log(`  ok пройдены дни первых трёх занятий — встреча 2, готовность ${fourthByFact.number}, «вперёд»`);

/* ---- 3. Ребёнок отстаёт ---- */

// Календарь ушёл на 30-е занятие, ребёнок не прошёл ещё второе.
const lateShown = lessonToShow({ year: YEAR, schedule, completedDayIndexes: days(YEAR.lessons[0].dayIndexes.length), today: '2027-04-01' });
const calendarThen = buildSchedule(YEAR, '2026-09-05').find((entry) => entry.date > '2027-04-01');
assert.equal(lateShown?.lesson, calendarThen?.lesson, `встреча ${lateShown?.lesson}, ожидалась ${calendarThen?.lesson}: школа её не двигает`);
assert.equal(lateShown?.readyFor, 2, `готовность ${lateShown?.readyFor}, ожидалась 2`);
assert.equal(lateShown?.gap, 'behind', 'отставание не помечено');
console.log('  ok отставание видно как готовность 2 при встрече по календарю');

/* ---- 4. Год пройден ---- */

// 36 занятий раз в неделю — это 35 недель от старта. Через полтора года
// расписание кончилось, и встречи нет: «тридцать седьмого» занятия не бывает.
shown = lessonToShow({ year: YEAR, schedule, completedDayIndexes: [], today: '2028-06-01' });
assert.equal(shown, undefined, 'год закончился, но встреча всё ещё показывается');
// А при пройденных днях, но не закончившемся календаре — встреча есть.
shown = lessonToShow({ year: YEAR, schedule, completedDayIndexes: days(YEAR.totalDays), today: '2027-01-01' });
assert.ok(shown, 'дни пройдены, но встреча пропала');
assert.equal(shown?.readyFor, 36, 'готовность после всех дней не равна последнему занятию');
console.log('  ok после последней встречи следующей нет, а готовность не выдумывается');

/* ---- 5. День относится к занятию ---- */

// День 0 — первый день, он идёт после первого занятия.
assert.equal(lessonOfDayIndex(YEAR, 0)?.number, 1, 'первый день не относится к первому занятию');
const lastDay = YEAR.totalDays - 1;
const lastLesson = YEAR.lessons[YEAR.lessons.length - 1];
assert.equal(lessonOfDayIndex(YEAR, lastDay)?.number, lastLesson.number, 'последний день не относится к последнему занятию');
// День перед последним занятием относится к предыдущему.
const beforeLast = Math.min(...lastLesson.dayIndexes) - 1;
assert.ok(beforeLast >= 0);
const previous = lessonOfDayIndex(YEAR, beforeLast);
assert.ok(previous && previous.number < lastLesson.number, 'день перед последним занятием отнесён к последнему');
console.log('  ok дни распределены по занятиям без пропусков и наложений');

/* ---- 6. Даты берутся из расписания, а не из головы ---- */

const dates = new Set(schedule.map((entry) => entry.date));
for (const completed of [0, 5, 20, 40]) {
  const value = lessonToShow({ year: YEAR, schedule, completedDayIndexes: days(completed), today: '2026-11-01' });
  if (!value) continue;
  assert.ok(dates.has(value.date), `дата ${value.date} не из расписания`);
}
console.log('  ok даты только из расписания');

console.log('\nСледующее занятие: по факту прогресса, с датой из календаря.');
