/**
 * Проверка календаря занятий и посещаемости.
 *
 * Что может сломаться тихо и почему это важно:
 *  1. Даты. Если считать их через `Date` в местном поясе, занятие «5 сентября»
 *     станет «4 сентября» в другом поясе. Расписание разъедется у педагога и
 *     родителя.
 *  2. Крайние случаи. 28 февраля + 7 дней, переход через год, високосный год.
 *  3. Доля посещаемости. Если считать `0` вместо «неизвестно» при отсутствии
 *     отметок, в отчтё попадает «посещаемость 0%» у ребёнка, которого просто
 *     ещё не отмечали.
 *  4. Отметки не должны менять исходное расписание: состояние живёт в
 *     хранилище, а модуль не должен быть местом, где данные меняются молча.
 *
 * Запуск: npm run test:year-lessons
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { validateStore } from '../lib/store-validation.ts';
import {
  attendanceSummary,
  buildSchedule,
  markAttendance,
  markShowcase,
  nextLesson,
  showcaseSummary,
  type ScheduledLesson,
} from '../lib/year/lessons.ts';

/* ---- 1. Расписание: 36 дат, раз в неделю ---- */

const schedule = buildSchedule(YEAR, '2026-09-01');
assert.equal(schedule.length, 36, `дат ${schedule.length}, ожидалось 36`);
assert.equal(schedule[0].date, '2026-09-01', 'первое занятие не в дату старта');
assert.equal(schedule[1].date, '2026-09-08', 'второе занятие не через неделю');
assert.equal(schedule[35].date, '2027-05-04', `последнее занятие ${schedule[35].date}, ожидалось 2027-05-04`);
console.log('  ok 36 дат по неделе от старта');

/* ---- 2. Переход через месяц, год и високосный февраль ---- */

const leap = buildSchedule(YEAR, '2028-02-22');
assert.equal(leap[0].date, '2028-02-22');
assert.equal(leap[1].date, '2028-02-29', 'високосный февраль разобран неверно');
assert.equal(leap[2].date, '2028-03-07', 'переход с 29 февраля на март неверен');

const yearEnd = buildSchedule(YEAR, '2026-12-29');
assert.equal(yearEnd[1].date, '2027-01-05', 'переход через год неверен');
console.log('  ok переходы через месяц, год и 29 февраля');

/* ---- 3. Отметка посещения не меняет исходное ---- */

const before = schedule.map((entry) => ({ ...entry }));
const marked = markAttendance(schedule, 1, true);
assert.equal(marked[0].attended, true, 'отметка не поставилась');
assert.equal(schedule[0].attended, undefined, 'исходное расписание изменилось');
assert.deepEqual(schedule, before, 'расписание изменилось после отметки');

assert.throws(() => markAttendance(schedule, 37, true), /нет в расписании/, 'отметка для несуществующего занятия не отвергнута');
assert.throws(() => markAttendance(schedule, 0, true), /нет в расписании/, 'занятие 0 принято');
console.log('  ok отметка не меняет исходное и отвергает несуществующие занятия');

/* ---- 4. Посещаемость ---- */

const empty = attendanceSummary(schedule, '2026-09-01');
assert.equal(empty.held, 1, 'до первого занятия прошло не одно');
assert.equal(empty.attended, 0);
assert.equal(empty.unmarked, 1, 'неотмеченное занятие не попало в unmarked');
assert.equal(empty.share, undefined, 'доля посещаемости при отсутствии отметок должна быть неизвестна, а не 0');

let mixed: ScheduledLesson[] = schedule;
mixed = markAttendance(mixed, 1, true);
mixed = markAttendance(mixed, 2, false);
mixed = markAttendance(mixed, 3, true);
const summary = attendanceSummary(mixed, '2026-09-15');
assert.equal(summary.held, 3, `прошло ${summary.held}, ожидалось 3`);
assert.equal(summary.attended, 2);
assert.equal(summary.missed, 1);
assert.equal(summary.unmarked, 0);
assert.ok(summary.share !== undefined && Math.abs(summary.share - 2 / 3) < 1e-9, 'доля посещаемости посчитана неверно');

// Занятие в будущем не считается прошедшим, даже если отмечено заранее.
const future = markAttendance(schedule, 10, true);
assert.equal(attendanceSummary(future, '2026-09-01').attended, 0, 'будущее занятие попало в посещённые');
console.log('  ok посещаемость: неизвестное не ноль, будущее не считается');

/* ---- 5. Следующее занятие ---- */

assert.equal(nextLesson(schedule, '2026-09-01')?.lesson, 1, 'сегодняшнее занятие должно быть следующим');
assert.equal(nextLesson(schedule, '2026-09-02')?.lesson, 2, 'после занятия следующим должно быть второе');
assert.equal(nextLesson(schedule, '2030-01-01'), undefined, 'после конца года следующего занятия быть не должно');
console.log('  ok следующее занятие определяется верно, включая конец года');

/* ---- 6. Даты уникальны и по возрастанию ---- */

const dates = schedule.map((entry) => entry.date);
assert.equal(new Set(dates).size, dates.length, 'даты занятий повторяются');
assert.deepEqual(dates, [...dates].sort(), 'даты идут не по возрастанию');
console.log('  ok даты уникальны и по возрастанию');

/* ---- 7. Валидатор хранилища ---- */

const baseStore = (lessons: unknown) => ({
  profiles: [{ id: 'p1', parentId: 'a1', name: 'Тест', age: 8, band: '8-10', createdAt: 1 }],
  skills: [],
  sessions: [],
  subs: [],
  programStates: [{ profileId: 'p1', completedDays: 0, lastDayIndex: 0, startedAt: 1, ...(lessons === undefined ? {} : { lessons }) }],
  playerStates: [],
  payments: [],
  events: [],
});

// Нормальное расписание проходит.
validateStore(baseStore(buildSchedule(YEAR, '2026-09-01')));
// Профиль без расписания тоже проходит: старые профили не должны ломаться.
validateStore(baseStore(undefined));
console.log('  ok расписание проходит валидатор, его отсутствие тоже');

const rejects = (lessons: unknown, reason: RegExp) => {
  assert.throws(() => validateStore(baseStore(lessons)), reason);
};

rejects([{ lesson: 1, date: '2026-09-01', attended: true, reason: 'болел' }], /Invalid lesson fields/);
rejects([{ lesson: 1, date: '2026-09-01', score: 5 }], /Invalid lesson fields/);
rejects([{ lesson: 1, date: '2026-09-01', attended: 'да' }], /Invalid attendance/);
rejects([{ lesson: 1, date: '1 сентября' }], /Invalid lesson date/);
rejects([{ lesson: 2, date: '2026-09-08' }, { lesson: 2, date: '2026-09-15' }], /Duplicate lesson number/);
rejects([{ lesson: 2, date: '2026-09-15' }, { lesson: 1, date: '2026-09-08' }], /out of order/);
rejects([{ lesson: 0, date: '2026-09-01' }], /Invalid lesson number/);
console.log('  ok валидатор не принимает причину отсутствия, оценку и кривые даты');

console.log('\nПосещаемость и календарь: 36 дат, валидатор, крайние случаи.');

/* ---- Показ: шкала выхода 0–2 ---- */

const showcase = YEAR.lessons.find((lesson) => lesson.isShowcase);
const ordinary = YEAR.lessons.find((lesson) => !lesson.isShowcase);
assert.ok(showcase && ordinary, 'в году нет показов или обычных занятий');

// Отметка на обычном занятии — ошибка вызывающего, а не данные.
assert.throws(() => markShowcase(schedule, YEAR, ordinary.number, 2), /не показ/, 'показ отмечен на обычном занятии');
assert.throws(() => markShowcase(schedule, YEAR, 999, 1), /нет в расписании/, 'отмечено несуществующее занятие');
assert.throws(() => markShowcase(schedule, YEAR, showcase.number, 3 as never), /вне шкалы/, 'принят уровень 3');

// Не мутирует исходное расписание.
const beforeShowcase = JSON.stringify(schedule);
const withShowcase = markShowcase(schedule, YEAR, showcase.number, 0);
assert.equal(JSON.stringify(schedule), beforeShowcase, 'отметка показа изменила исходное расписание');
assert.equal(withShowcase.find((entry) => entry.lesson === showcase.number)?.showcase, 0);

// Отказ считается отдельно, а не растворяется в среднем.
let year = markShowcase(schedule, YEAR, showcase.number, 0);
const second = YEAR.lessons.filter((lesson) => lesson.isShowcase)[1];
year = markShowcase(year, YEAR, second.number, 2);
const showcaseBox = showcaseSummary(year, YEAR);
assert.equal(showcaseBox.refused, 1, `отказов ${showcaseBox.refused}, ожидался 1`);
assert.equal(showcaseBox.shows, 1, `выходов ${showcaseBox.shows}, ожидался 1`);
assert.equal(showcaseBox.marked, 2, `отмечено ${showcaseBox.marked}, ожидалось 2`);

// Пустая сводка не врёт нулём: ноль отмеченных — это «не отмечено».
assert.equal(showcaseSummary(schedule, YEAR).marked, 0);
assert.equal(showcaseSummary(schedule, YEAR).refused, 0);
console.log('  ok показ: шкала 0–2, отказ отдельным счётчиком, обычное занятие отвергается');
