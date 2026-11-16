/**
 * Методические материалы: ФГОС, страницы занятий, видео, запасные упражнения.
 *
 * Что здесь важно и почему именно так.
 *
 * ФГОС — это документ, на который ссылается школа. Ошибка в нём дороже ошибки в
 * тексте для родителя: завуч сверит с рабочей программой. Поэтому проверяется
 * не «таблица есть», а что каждая из 36 строк заполнена и что коды не выдуманы.
 *
 * Страница занятия — единственное место, где мы говорим родителю «как это видно
 * в жизни». Проверяется, что примеры конкретные (место + действие), а не
 * «станет эмпатичнее».
 *
 * Видео и запас — то, без чего педагог не начнёт. Проверяется, что у каждого
 * ролика есть что снимать и что должно быть видно, а запасной набор не
 * превращается в замену занятия.
 *
 * Запуск: npm run test-year-method-materials
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import {
  AREA_BY_COMPETENCY,
  FGOS_AREA_LABEL,
  FGOS_LABEL,
  alignYear,
  competenciesOfLesson,
  fgosCoverage,
} from '../lib/year/fgos.ts';
import { lessonPage } from '../lib/year/valued.ts';
import { DEMOS, demosForBlock, totalSeconds } from '../lib/year/demos.ts';
import { BACKUP_EXERCISES, SITUATION_LABEL, backupFor } from '../lib/year/backup-exercises.ts';

const alignments = alignYear(YEAR);

/* ---- 1. ФГОС: 36 строк, ни одной пустой ---- */

assert.equal(alignments.length, 36, `строк разметки ${alignments.length}, ожидалось 36`);
for (const alignment of alignments) {
  assert.ok(alignment.competencies.length > 0, `занятие ${alignment.lesson}: нет компетенций`);
  assert.ok(alignment.groups.length > 0, `занятие ${alignment.lesson}: нет результатов ФГОС`);
  assert.ok(alignment.areas.length > 0, `занятие ${alignment.lesson}: нет направлений`);
  assert.ok(alignment.wording.length > 40, `занятие ${alignment.lesson}: формулировка короче строки`);
  assert.ok(
    !/уточняется методистом/.test(alignment.wording),
    `занятие ${alignment.lesson}: формулировка не собрана, осталась заглушка`,
  );
}
console.log('  ok 36 строк ФГОС, у каждой компетенция, направление и формулировка');

/* ---- 2. Компетенции берутся из содержания, а не из когнитивных навыков ---- */

// Ошибка первого прогона: разметка шла по Lesson.skills, а там inhibition и
// attention — когнитивные навыки. Все 36 занятий получались без компетенций.
const first = YEAR.lessons[0];
assert.ok(first.skills.includes('inhibition'), 'тест опирается на устройство данных: ожидался когнитивный навык');
const competencies = competenciesOfLesson(first);
assert.ok(competencies.length > 0, 'компетенции занятия пусты: разметка снова идёт по когнитивным навыкам');
console.log('  ok компетенции из темы и сценариев, а не из когнитивных навыков');

/* ---- 2b. Формулировки различимы между занятиями ---- */

/**
 * Первая версия разметки давала 14 формулировок на 36 занятий: семь занятий
 * подряд описывались одинаково («умение возвращаться к задаче после сбоя»).
 * Для школы это выглядит как скопированная строка, и справедливый вопрос
 * завуча — «чем эти семь занятий отличаются».
 *
 * Требование: у каждого занятия своя формулировка, и в ней названо, на каком
 * материале идёт работа.
 */
const wordings = alignments.map((item) => item.wording);
const uniqueWordings = new Set(wordings);
assert.equal(
  uniqueWordings.size,
  alignments.length,
  `формулировок ${uniqueWordings.size} на ${alignments.length} занятий: у части занятий строки совпадают`,
);
// Длина: строка идёт в таблицу рабочей программы одной ячейкой. 234 символа
// (три компетенции и два материала) — предел, дальше ячейку не читают.
const wordLengths = wordings.map((wording) => wording.length);
assert.ok(
  Math.max(...wordLengths) <= 240,
  `самая длинная формулировка — ${Math.max(...wordLengths)} символов, ячейку не прочитают`,
);
for (const alignment of alignments) {
  assert.ok(
    /на материале ситуаций/.test(alignment.wording),
    `занятие ${alignment.lesson}: в формулировке не сказано, на каком материале идёт работа`,
  );
  assert.ok(
    /«[^»]+»/.test(alignment.wording),
    `занятие ${alignment.lesson}: материал назван без названия ситуации`,
  );
}
console.log(`  ok ${uniqueWordings.size} разные формулировки на 36 занятий, у каждой — свой материал`);

/* ---- 3. Формулировки не оценивают ребёнка ---- */

const allWording = alignments.map((item) => item.wording).join(' ');
for (const re of [/уровень/i, /балл/i, /рейтинг/i, /диагностик/i]) {
  assert.ok(!re.test(allWording), `в формулировках для школы оценочное слово: ${re}`);
}
// «Формируется» не утверждает, что результат достигнут. «Сформирован» — утверждает.
assert.ok(!/сформирован[аоы]?\b/i.test(allWording), 'формулировка утверждает достигнутый результат');
console.log('  ok формулировки для школы без оценок и без утверждений о достигнутом');

/* ---- 4. Сводка покрытия не врёт ---- */

const coverage = fgosCoverage(alignments);
const totalByGroup = Object.values(coverage.byGroup).reduce((sum, value) => sum + value, 0);
const expectedByGroup = alignments.reduce((sum, item) => sum + item.groups.length, 0);
assert.equal(totalByGroup, expectedByGroup, 'сводка по группам не сходится с разметкой');

for (const [area, lessons] of Object.entries(coverage.lessonsByArea)) {
  assert.equal(lessons.length, coverage.byArea[area as keyof typeof coverage.byArea], `направление ${area}: номера не сходятся со счётчиком`);
  assert.ok(lessons.every((number) => number >= 1 && number <= 36), `направление ${area}: номер вне года`);
}
// Коммуникация должна быть: это первое, что спросит завуч.
assert.ok(coverage.byArea.communication > 0, 'нет ни одного занятия на коммуникацию');
console.log(`  ok покрытие: личностные ${coverage.byGroup.personal}, метапредметные ${coverage.byGroup.meta}, коммуникация в ${coverage.byArea.communication} занятиях`);

/* ---- 5. Каждая компетенция заведена в ФГОС и наоборот ---- */

import type { CompetencyId } from '../lib/types.ts';
const allCompetencies: CompetencyId[] = [
  'self_awareness',
  'self_regulation',
  'empathy',
  'relationships',
  'decision_making',
  'creative_thinking',
  'growth_mindset',
];
for (const competency of allCompetencies) {
  assert.ok(AREA_BY_COMPETENCY[competency]?.length, `компетенция ${competency} не размечена под ФГОС`);
}
for (const group of Object.keys(FGOS_LABEL)) {
  assert.ok(group, 'группа ФГОС без ключа');
}
for (const area of Object.keys(FGOS_AREA_LABEL)) {
  assert.ok(area, 'направление без ключа');
}
console.log('  ok все семь компетенций размечены, всех направлений есть названия');

/* ---- 6. Страница занятия: конкретно, а не абстрактно ---- */

for (const lesson of YEAR.lessons) {
  const alignment = alignments.find((item) => item.lesson === lesson.number);
  const page = lessonPage(lesson, alignment?.wording ?? '');

  assert.ok(page.trained.length > 10, `занятие ${lesson.number}: не сказано, что тренировали`);
  assert.ok(page.examples.length >= 2, `занятие ${lesson.number}: меньше двух примеров из жизни`);
  for (const example of page.examples) {
    assert.ok(example.where.length > 3, `занятие ${lesson.number}: пример без места`);
    assert.ok(example.what.length > 15, `занятие ${lesson.number}: пример без действия`);
    // Абстракции вроде «в общении со сверстниками» нельзя узнать в понедельник.
    assert.ok(!/со сверстниками|в общении/i.test(example.where), `занятие ${lesson.number}: пример абстрактный`);
  }
  assert.ok(page.scenes.length > 0, `занятие ${lesson.number}: не названы истории занятия`);
  assert.ok(page.noticeAtHome.length > 30, `занятие ${lesson.number}: нет наблюдения для дома`);
  assert.ok(page.fgosWording.length > 20, `занятие ${lesson.number}: страница без результата ФГОС`);
}
/**
 * Страница должна быть про конкретное занятие, а не про тему.
 *
 * Первая версия давала 13 разных страниц на 36 занятий: четыре недели подряд
 * «замечать, что чувствуешь» с одними и теми же примерами. Родитель читает это
 * на четвёртый четверг и перестаёт открывать.
 */
const pageTexts = new Set(
  YEAR.lessons.map((lesson) => {
    const alignment = alignments.find((item) => item.lesson === lesson.number);
    const page = lessonPage(lesson, alignment?.wording ?? '');
    return `${page.trained}|${page.scenes.join(',')}|${page.examples.map((e) => e.where).join(',')}`;
  }),
);
assert.equal(pageTexts.size, YEAR.lessons.length, `разных страниц ${pageTexts.size} на 36 занятий: часть занятий выглядит одинаково`);

console.log('  ok 36 страниц: что тренировали, истории занятия, примеры, наблюдение, ФГОС');

/* ---- 7. Видео: есть что снимать ---- */

assert.ok(DEMOS.length >= 10, `роликов ${DEMOS.length}, нужно не меньше 10`);
const ids = new Set(DEMOS.map((demo) => demo.id));
assert.equal(ids.size, DEMOS.length, 'у роликов повторяются идентификаторы');

for (const demo of DEMOS) {
  assert.ok(demo.seconds > 0 && demo.seconds <= 300, `ролик «${demo.title}»: ${demo.seconds} секунд`);
  assert.ok(demo.shot.length > 20, `ролик «${demo.title}»: нет описания кадра`);
  assert.ok(demo.says.length > 20, `ролик «${demo.title}»: нет прямой речи`);
  assert.ok(demo.mustSee.length > 20, `ролик «${demo.title}»: нет критерия, что видно`);
}

// Сумма важна: если это дольше получаса, педагог не посмотрит перед занятием.
const minutes = Math.round(totalSeconds() / 60);
assert.ok(minutes <= 35, `все ролики ${minutes} минут — педагог не посмотрит это перед занятием`);

// Показ — самый тревожный блок, у него должно быть больше одного ролика.
assert.ok(demosForBlock('showcase').length >= 2, 'на показ меньше двух роликов');
assert.ok(demosForBlock('trouble').length >= 2, 'на сложные ситуации меньше двух роликов');
console.log(`  ok ${DEMOS.length} роликов, ${minutes} минут суммарно, показ и сложности покрыты`);

/* ---- 8. Запас: по ситуации, но не вместо занятия ---- */

assert.ok(BACKUP_EXERCISES.length >= 12, `запасных упражнений ${BACKUP_EXERCISES.length}, нужно не меньше 12`);
const backupIds = new Set(BACKUP_EXERCISES.map((exercise) => exercise.id));
assert.equal(backupIds.size, BACKUP_EXERCISES.length, 'у запасных упражнений повторяются идентификаторы');

for (const exercise of BACKUP_EXERCISES) {
  assert.ok(exercise.minutes > 0 && exercise.minutes <= 12, `упражнение «${exercise.title}»: ${exercise.minutes} минут`);
  assert.ok(exercise.lead.length > 20, `упражнение «${exercise.title}»: нет указания`);
  assert.ok(exercise.why.length > 20, `упражнение «${exercise.title}»: нет объяснения`);
  assert.ok(SITUATION_LABEL[exercise.situation], `упражнение «${exercise.title}»: неизвестная ситуация`);
}

// На каждую ситуацию — минимум два варианта: один не даёт выбора.
for (const situation of Object.keys(SITUATION_LABEL) as (keyof typeof SITUATION_LABEL)[]) {
  assert.ok(backupFor(situation).length >= 2, `ситуация «${SITUATION_LABEL[situation]}»: меньше двух упражнений`);
}
console.log(`  ok ${BACKUP_EXERCISES.length} запасных упражнений, на каждую из шести ситуаций — минимум два`);

/* ---- 9. Запас не отменяет занятие ---- */

const backupText = JSON.stringify(BACKUP_EXERCISES);
// Если запасной набор превращается в «просто поиграем», занятие теряется.
for (const re of [/просто поигра/i, /займём время/i, /подождём/i]) {
  assert.ok(!re.test(backupText), `запасной набор заполняет время, а не держит форму: ${re}`);
}
console.log('  ok запас не превращается в «занять время»');

console.log('\nМетодические материалы: ФГОС, страницы, видео и запас — собраны и проверены.');
