/**
 * Сводка для школы.
 *
 * Зачем тест. Это документ, который уходит завучу и в котором каждая цифра
 * читается как обещание. Ошибка здесь не падает и не видна в интерфейсе: школа
 * планирует часы, родители ждут результата, а числа взяты из старой версии.
 *
 * Что проверяется:
 *  - числа совпадают с кодом, а не с текстом документа (36 занятий, 40 минут,
 *    12 тем, 60 историй, 12 показов, 5 линеек/треков);
 *  - у каждого факта указан источник: завуч может проверить;
 *  - сумма минут в блоках равна длине встречи;
 *  - нет обещаний оценок, IQ, «эффективности в процентах»;
 *  - нет медицинских слов и слова «диагностика»;
 *  - границы метода названы, а не спрятаны.
 *
 * Запуск: npm run test-year-school
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { PROGRAM, TOTAL_DAYS } from '../lib/content/program/index.ts';
import { MEETING_MINUTES } from '../lib/year/meeting.ts';
import {
  SCHOOL_LIMITS,
  SCHOOL_MEASURES,
  SCHOOL_NEEDS,
  schoolFacts,
  schoolMeetingBlocks,
  schoolOutline,
  schoolStages,
} from '../lib/year/school.ts';

const facts = schoolFacts();
const byLabel = (label: string) => facts.find((fact) => fact.label === label);

/* ---- 1. Числа совпадают с кодом ---- */

assert.equal(byLabel('Занятий в году')?.value, String(YEAR.lessons.length), 'число занятий не совпадает с годом');
assert.equal(byLabel('Длина встречи')?.value, `${MEETING_MINUTES} минут`, 'длина встречи не совпадает с планом');
assert.equal(byLabel('Тем в программе')?.value, String(PROGRAM.length), 'число тем не совпадает с программой');
assert.equal(byLabel('Историй для домашней практики')?.value, String(TOTAL_DAYS), 'число историй не совпадает');
assert.equal(
  byLabel('Показов за год')?.value,
  String(YEAR.lessons.filter((lesson) => lesson.isShowcase).length),
  'число показов не совпадает с годом',
);

// Часы — арифметика, а не отдельное число в тексте.
const hours = byLabel('Академических часов за год');
assert.ok(hours, 'в сводке нет академических часов');
const expectedHours = Math.round(((YEAR.lessons.length * MEETING_MINUTES) / 45) * 10) / 10;
assert.equal(Number(hours.value), expectedHours, `часов ${hours.value}, по расчёту ${expectedHours}`);
console.log(`  ok числа из кода: ${YEAR.lessons.length} занятий, ${MEETING_MINUTES} минут, ${PROGRAM.length} тем, ${TOTAL_DAYS} историй`);

/* ---- 2. У каждого факта есть источник ---- */

for (const fact of facts) {
  assert.ok(fact.label.length > 3, `факт без названия: ${fact.value}`);
  assert.ok(fact.value.length > 0, `факт «${fact.label}» без значения`);
  assert.ok(fact.source.length > 8, `факт «${fact.label}» без источника — завучу нечего проверить`);
}
console.log(`  ok ${facts.length} фактов, у каждого указан источник`);

/* ---- 3. Структура курса сходится с годом ---- */

const outline = schoolOutline();
assert.equal(outline.length, PROGRAM.length, 'в структуре не все темы');
assert.equal(
  outline.reduce((sum, item) => sum + item.lessons, 0),
  YEAR.lessons.length,
  'сумма занятий по темам не равна числу занятий года',
);
assert.equal(outline.filter((item) => item.showcase).length, 12, 'не в каждой теме есть показ');
for (const item of outline) {
  assert.ok(item.title.length > 3, `тема ${item.unit} без названия`);
  assert.ok(item.lessons >= 2 && item.lessons <= 4, `тема ${item.unit}: ${item.lessons} занятий — это не тема, а одно занятие или четверть`);
}
console.log('  ok 12 тем, занятия по темам сходятся с годом, показ в каждой теме');

/* ---- 4. Минуты встречи ---- */

const blocks = schoolMeetingBlocks();
assert.equal(blocks.reduce((sum, block) => sum + block.minutes, 0), MEETING_MINUTES, 'сумма блоков не равна длине встречи');
assert.equal(blocks.length, 5, `блоков ${blocks.length}, ожидалось 5`);
console.log(`  ok ${blocks.length} блоков, сумма ${MEETING_MINUTES} минут`);

/* ---- 5. Этапы ---- */

const stages = schoolStages();
assert.equal(stages.length, 3, 'этапов не три');
assert.equal(new Set(stages.map((stage) => stage.question)).size, 3, 'вопросы этапов повторяются');
console.log('  ok три этапа с разными вопросами');

/* ---- 6. Что измеряется: границы названы ---- */

assert.ok(SCHOOL_MEASURES.length >= 5, 'меньше пяти пунктов о том, что измеряется');
for (const measure of SCHOOL_MEASURES) {
  assert.ok(measure.what.length > 5, 'пункт без названия');
  assert.ok(measure.how.length > 20, `«${measure.what}»: не сказано, как`);
  assert.ok(measure.limit.length > 20, `«${measure.what}»: не сказано, чего это не значит`);
}
console.log(`  ok ${SCHOOL_MEASURES.length} пункта замера, у каждого названо ограничение`);

/* ---- 7. Нет обещаний и медицины ---- */

const text = JSON.stringify({ facts, outline, stages, measures: SCHOOL_MEASURES, needs: SCHOOL_NEEDS, limits: SCHOOL_LIMITS });
for (const bad of [
  /повышает успеваемость/i,
  /\bIQ\b/i,
  /успешн[а-я]* в жизни/i,
  /гарантиру/i,
  /эффективност[а-я]* на \d+ ?%/i,
  /терапи/i,
  /коррекц/i,
  /диагноз/i,
  /диагностик/i,
  /лечит/i,
]) {
  assert.ok(!bad.test(text), `в сводке для школы есть недопустимое: ${bad}`);
}

// «Развивает» допустимо, «формирует личность» — уже обещание.
assert.ok(!/формиру[а-я]+ личност/i.test(text), 'сводка обещает формирование личности');
console.log('  ok ни обещаний, ни медицины, ни слова «диагностика»');

/* ---- 8. Границы и потребности названы ---- */

assert.ok(SCHOOL_LIMITS.length >= 4, 'границ меньше четырёх — это уже реклама');
assert.ok(SCHOOL_LIMITS.some((line) => /не заменяет работу психолога/i.test(line)), 'не сказано, что метод не заменяет психолога');
assert.ok(SCHOOL_LIMITS.some((line) => /не обещает роста оценок/i.test(line)), 'не сказано об оценках');
assert.ok(SCHOOL_NEEDS.length >= 4, 'потребностей меньше четырёх');
assert.ok(SCHOOL_NEEDS.some((line) => /второй взрослый/i.test(line)), 'не сказано про второго взрослого');
console.log('  ok границы и потребности школы названы');

console.log('\nСводка для школы: числа из кода, границы названы.');
