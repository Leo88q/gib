/**
 * Быстрые разборы занятий.
 *
 * Зачем тест. Разбор — это текст, который педагог читает перед занятием и
 * верит ему. Ошибка здесь не падает и не видна в интерфейсе: педагог ищет в
 * плане упражнение, которого нет, и решает, что план сломан.
 *
 * Ровно так и было на первом прогоне: разбор показов брал `practiceWhy` от
 * упражнения, а на показе упражнения нет. Все 12 показов описывали то, чего
 * дети не делают.
 *
 * Проверяется:
 *  - 36 разборов, по одному на занятие, без повторов номеров;
 *  - каждый читается меньше минуты (обещание «разбор на минуту» — проверяемое);
 *  - у каждого есть что делают дети, зачем, на что смотреть и что не потерять;
 *  - на показе разбор говорит про площадку, а не про упражнение;
 *  - в разборе нет оценок ребёнка и медицинских слов.
 *
 * Запуск: npm run test-year-briefs
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { quickBrief, quickBriefs, showcaseBriefs, totalBriefMinutes } from '../lib/year/briefs.ts';

const briefs = quickBriefs(YEAR);

/* ---- 1. По разбору на занятие ---- */

assert.equal(briefs.length, 36, `разборов ${briefs.length}, ожидалось 36`);
const numbers = briefs.map((brief) => brief.lesson).sort((a, b) => a - b);
assert.deepEqual(
  numbers,
  Array.from({ length: 36 }, (_, i) => i + 1),
  'номера занятий в разборах не совпадают с годом',
);
console.log('  ok 36 разборов, по одному на занятие, без пропусков');

/* ---- 2. Каждый укладывается в минуту ---- */

const longest = briefs.reduce((max, brief) => (brief.seconds > max.seconds ? brief : max), briefs[0]);
assert.ok(longest.seconds < 60, `самый длинный разбор (занятие ${longest.lesson}) — ${longest.seconds} секунд`);

const total = totalBriefMinutes(briefs);
assert.ok(total <= 30, `все разборы — ${total} минут: это уже чтение на вечер, а не перед занятием`);
console.log(`  ok самый длинный ${longest.seconds} сек, все 36 — ${total} минут`);

/* ---- 3. В разборе есть действия, а не только смысл ---- */

for (const brief of briefs) {
  assert.ok(brief.unitTitle.length > 3, `занятие ${brief.lesson}: нет названия`);
  assert.ok(brief.about.length > 3, `занятие ${brief.lesson}: не сказано, о чём оно`);
  assert.ok(brief.whatChildrenDo.length > 30, `занятие ${brief.lesson}: не сказано, что делают дети`);
  assert.ok(brief.why.length > 20, `занятие ${brief.lesson}: не сказано, зачем`);
  assert.ok(brief.watchFor.length > 40, `занятие ${brief.lesson}: не сказано, на что смотреть`);
  assert.ok(brief.keep.length > 10, `занятие ${brief.lesson}: не сказано, что не потерять`);
  assert.ok(brief.askYourself.includes('?'), `занятие ${brief.lesson}: вместо вопроса утверждение`);
}
console.log('  ok в каждом: что делают, зачем, на что смотреть, что не потерять, вопрос');

/* ---- 3b. Разборы различимы между занятиями ---- */

/**
 * Первая версия давала одинаковый разбор у всех занятий одной компетенции:
 * у семи уроков саморегуляции текст совпадал слово в слово. Педагог,
 * открывший разбор седьмой раз, не находил в нём ничего про своё занятие.
 */
const byContent = new Map<string, number[]>();
for (const brief of briefs) {
  const key = `${brief.about}|${brief.whatChildrenDo}|${brief.scenes.join(',')}`;
  byContent.set(key, [...(byContent.get(key) ?? []), brief.lesson]);
}
const collisions = [...byContent.entries()].filter(([, lessons]) => lessons.length > 1);
assert.deepEqual(
  collisions.map(([, lessons]) => lessons.join(',')),
  [],
  `разборы совпадают у занятий: ${collisions.map(([, l]) => l.join(',')).join(' / ')}`,
);

for (const brief of briefs) {
  assert.ok(brief.scenes.length > 0, `занятие ${brief.lesson}: в разборе нет историй занятия`);
  // История — из контента, а не выдуманная: она должна быть короткой строкой
  // без точки в конце, как названия сцен в программе.
  for (const scene of brief.scenes) {
    assert.ok(scene.length > 3 && scene.length < 60, `занятие ${brief.lesson}: странное название истории «${scene}»`);
    assert.ok(!scene.endsWith('.'), `занятие ${brief.lesson}: в названии истории точка: «${scene}»`);
  }
}
console.log(`  ok ${byContent.size} разных разборов на 36 занятий, у каждого — свои истории`);

/* ---- 4. Показ не рассказывает про упражнение ---- */

const showcases = showcaseBriefs(YEAR);
assert.equal(showcases.length, 12, `разборов показов ${showcases.length}, ожидалось 12`);
for (const brief of showcases) {
  assert.ok(/показ/i.test(brief.unitTitle), `занятие ${brief.lesson}: показ не назван показом`);
  assert.ok(
    /площадк|зрител|выход/i.test(brief.whatChildrenDo + brief.why),
    `занятие ${brief.lesson}: разбор показа не про выход на площадку`,
  );
  // Упражнение в разборе показа — следствие ошибки, которую этот тест и ловит.
  assert.ok(
    !/«[^»]+» — навык в действии/.test(brief.whatChildrenDo),
    `занятие ${brief.lesson}: на показе описано упражнение, которого не будет`,
  );
}
console.log('  ok 12 показов: разбор про площадку и готовность, а не про упражнение');

/* ---- 5. Разбор не оценивает ребёнка ---- */

const text = JSON.stringify(briefs);
for (const re of [/уровень/i, /балл/i, /рейтинг/i, /диагностик/i, /справил/i, /не готов/i]) {
  assert.ok(!re.test(text), `в разборах оценочное слово: ${re}`);
}
for (const re of [/терапи/i, /коррекц/i, /диагноз/i, /расстройств/i]) {
  assert.ok(!re.test(text), `в разборах медицинское слово: ${re}`);
}
console.log('  ok нет оценок ребёнка, нет медицинских слов');

/* ---- 6. Разбор не обещает результата ---- */

for (const re of [/разовьёт/i, /повысит/i, /улучшит успеваем/i, /гарантиру/i]) {
  assert.ok(!re.test(text), `разбор обещает результат: ${re}`);
}
console.log('  ok обещаний результата нет');

/* ---- 7. Разбор устойчив к одному занятию ---- */

const single = quickBrief(YEAR.lessons[5]);
assert.equal(single.lesson, 6, 'разбор собрался не по тому занятию');
assert.ok(single.seconds > 0, 'у разбора нет времени чтения');
console.log('  ok разбор собирается и по одному занятию');

console.log('\nБыстрые разборы: 36 карточек, показ отличается от занятия, оценок нет.');
