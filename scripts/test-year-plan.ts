/**
 * Проверка годовой сетки: 36 занятий, 60 дней, каждый день на своём месте.
 *
 * Зачем. Год надстраивается над днями симулятора, и самая вероятная поломка —
 * тихая: день потерялся при раскладке, попал в два занятия или ни в одно.
 * Снаружи это не видно: программа всё ещё показывает 60 дней, прогресс
 * считается, и только ребёнок не получает часть практики.
 *
 * Проверяется:
 *  1. занятий ровно 36, дней ровно 60;
 *  2. каждое занятие темы получает хотя бы один день;
 *  3. каждый день принадлежит ровно одному занятию, порядок не нарушен;
 *  4. в каждой теме одно завершающее занятие (мини-показ) — итого 12;
 *  5. прогресс не засчитывает занятие, если пройдены не все его дни;
 *  6. навыки занятия — навыки его дней, без выдуманных.
 *
 * Запуск: npm run test:year
 */

import { strict as assert } from 'node:assert';
import { YEAR, lessonOfDay, lessonsOfUnit, yearProgress } from '../lib/content/year/index.ts';
import { PROGRAM, PROGRAM_DAYS, TOTAL_DAYS } from '../lib/content/program/index.ts';

/* ---- 1. Размеры ---- */

assert.equal(YEAR.total, 36, `занятий ${YEAR.total}, ожидалось 36`);
assert.equal(YEAR.totalDays, TOTAL_DAYS, `дней ${YEAR.totalDays}, а в программе ${TOTAL_DAYS}`);
assert.equal(TOTAL_DAYS, 60, `в программе ${TOTAL_DAYS} дней, ожидалось 60`);
console.log('  ok 36 занятий и 60 дней');

/* ---- 2. У каждого занятия есть дни ---- */

for (const lesson of YEAR.lessons) {
  assert.ok(
    lesson.dayIndexes.length > 0,
    `занятие ${lesson.number} (тема ${lesson.unit}, ${lesson.inUnit}/${lesson.ofUnit}) без дней: пустое занятие в расписании`,
  );
}
console.log('  ok ни одного пустого занятия');

/* ---- 3. Каждый день — ровно в одном занятии, по порядку ---- */

const seen = new Map<number, number>();
for (const lesson of YEAR.lessons) {
  for (const index of lesson.dayIndexes) {
    assert.ok(!seen.has(index), `день ${index} попал в два занятия: ${seen.get(index)} и ${lesson.number}`);
    seen.set(index, lesson.number);
  }
}

assert.equal(seen.size, TOTAL_DAYS, `разложено ${seen.size} дней из ${TOTAL_DAYS}: часть потерялась`);
for (let index = 0; index < TOTAL_DAYS; index += 1) {
  assert.ok(seen.has(index), `день ${index} не попал ни в одно занятие`);
}

// Порядок дней внутри занятия и занятий между собой должен совпадать с порядком
// программы, иначе ребёнок пройдёт день 47 раньше дня 12.
const flat = YEAR.lessons.flatMap((lesson) => lesson.dayIndexes);
assert.deepEqual(flat, [...flat].sort((a, b) => a - b), 'дни внутри года идут не по порядку');
console.log('  ok все 60 дней разложены по одному разу и по порядку');

/* ---- 4. Мини-показы ---- */

const showcases = YEAR.lessons.filter((lesson) => lesson.isShowcase);
assert.equal(showcases.length, 12, `мини-показов ${showcases.length}, ожидалось 12 — по одному на тему`);
for (const unit of PROGRAM) {
  const inUnit = lessonsOfUnit(YEAR, unit.week).filter((lesson) => lesson.isShowcase);
  assert.equal(inUnit.length, 1, `в теме ${unit.week} ${inUnit.length} завершающих занятий, ожидалось одно`);
}
console.log('  ok 12 мини-показов, по одному на тему');

/* ---- 5. Прогресс ---- */

assert.equal(yearProgress(YEAR, []).lessonsDone, 0, 'на старте не должно быть пройденных занятий');

// Первое занятие темы 1 — это дни 0..1. Один день из двух — занятие ещё не пройдено.
const firstLesson = YEAR.lessons[0];
assert.ok(firstLesson.dayIndexes.length > 1, 'первое занятие должно занимать больше одного дня');
assert.equal(
  yearProgress(YEAR, [firstLesson.dayIndexes[0]]).lessonsDone,
  0,
  'занятие засчитано по одному дню: ребёнок не дошёл до конца',
);
assert.equal(
  yearProgress(YEAR, firstLesson.dayIndexes).lessonsDone,
  1,
  'занятие не засчитано, хотя пройдены все его дни',
);

// Полный год
const allDays = Array.from({ length: TOTAL_DAYS }, (_, i) => i);
const finished = yearProgress(YEAR, allDays);
assert.equal(finished.lessonsDone, 36, `при полном прохождении занятий ${finished.lessonsDone}, ожидалось 36`);
assert.equal(finished.currentLesson, undefined, 'после полного года текущего занятия быть не должно');
console.log('  ok прогресс не засчитывает недойденное занятие и засчитывает полный год');

/* ---- 6. Навыки и принадлежность ---- */

for (const lesson of YEAR.lessons) {
  const expected = new Set(
    lesson.dayIndexes.map((index) => PROGRAM_DAYS[index].day.focus),
  );
  assert.deepEqual(
    new Set(lesson.skills),
    expected,
    `навыки занятия ${lesson.number} не совпадают с навыками его дней`,
  );
}

const orphan = lessonOfDay(YEAR, 59);
assert.ok(orphan, 'день 59 не нашёл своё занятие');
assert.equal(lessonOfDay(YEAR, 0)?.number, 1, 'день 0 должен относиться к первому занятию');
console.log('  ok навыки занятия — навыки его дней, каждый день находит своё занятие');

/* ---- 7. Числа занятий по темам совпадают с решением ---- */

const DECIDED = [4, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3];
for (const unit of PROGRAM) {
  const count = lessonsOfUnit(YEAR, unit.week).length;
  assert.equal(
    count,
    DECIDED[unit.week - 1],
    `тема ${unit.week}: занятий ${count}, по решению ${DECIDED[unit.week - 1]}`,
  );
}
console.log('  ok число занятий по темам совпадает с утверждённой сеткой');

console.log('\nГодовая сетка: 36 занятий, 60 дней, 12 показов, порядок сохранён.');
