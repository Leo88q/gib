/**
 * Лестница выхода и работа с тревожным ребёнком.
 *
 * Почему это проверяется тестом, а не доверием. Здесь два риска, и оба тихие:
 *
 *  1. Лестница превращается в давление. Тогда она не помогает выйти, а
 *     заставляет — и методика ломается надёжнее, чем без лестницы.
 *  2. Приёмы начинают объяснять ребёнка медициной: «тревожный», «коррекция»,
 *     «диагноз». Это и правовой риск, и обещание, которое продукт не выполнит.
 *
 * Проверяется:
 *  - ступени идут по порядку и у каждой есть следующий шаг и запрет;
 *  - ступень берётся по последней отметке, а не по средней;
 *  - «ещё не выходил» отличается от «отказался»;
 *  - отказы подряд считаются верно, пропуски не считаются отказом;
 *  - после трёх отказов подсказка требует разговора, а не уговоров;
 *  - в текстах нет медицинских слов и нет принуждения.
 *
 * Запуск: npm run test-year-stage
 */

import { strict as assert } from 'node:assert';
import { REFUSAL_ALERT, STAGE_LADDER, refusalsInRow, stageFor } from '../lib/year/stage.ts';
import { ANXIOUS_TECHNIQUES, AFTER_THREE_REFUSALS, PHRASES_TO_AVOID, hintFor } from '../lib/year/anxious.ts';

/* ---- 1. Лестница ---- */

assert.equal(STAGE_LADDER.length, 4, `в лестнице ${STAGE_LADDER.length} ступеней, ожидалось 4`);
STAGE_LADDER.forEach((step, index) => {
  assert.equal(step.step, index, `ступени идут не по порядку: ${step.step} на месте ${index}`);
  assert.ok(step.title.length > 5, `ступень ${index} без названия`);
  assert.ok(step.next.length > 30, `ступень ${index} без следующего шага`);
  assert.ok(step.avoid.length > 20, `ступень ${index} без запрета`);
});
console.log('  ok четыре ступени, у каждой есть шаг дальше и запрет');

/* ---- 2. Ступень берётся по последней отметке ---- */

assert.equal(stageFor(0).step, 0, 'отказ дал не нулевую ступень');
assert.equal(stageFor(1).step, 2, 'выход по приглашению дал не вторую ступень');
assert.equal(stageFor(2).step, 3, 'самостоятельный выход дал не третью ступень');

// «Ещё не выходил» — не то же, что «отказался»: разные подсказки педагогу.
const never = stageFor(undefined);
assert.equal(never.step, 0);
assert.ok(/не выходил/i.test(never.title), 'неотличимо от отказа: педагог начнёт с уговоров');
assert.notEqual(never.title, stageFor(0).title, '«ещё не выходил» и «отказался» — один текст');
console.log('  ok ступень по последней отметке, «не выходил» отличается от отказа');

/* ---- 3. Отказы подряд ---- */

assert.equal(refusalsInRow([]), 0, 'пустая история дала отказы');
assert.equal(refusalsInRow([0]), 1);
assert.equal(refusalsInRow([0, 0]), 2);
// Выход прерывает серию: ребёнок вышел, дальше отказы считаются заново.
assert.equal(refusalsInRow([0, 0, 1, 0]), 1, 'серия не прервалась выходом');
// Пропуск не считается отказом: ребёнка могло не быть.
assert.equal(refusalsInRow([0, undefined, 0]), 2, 'пропуск сломал подсчёт отказов');
assert.equal(refusalsInRow([1, undefined, undefined]), 0);
console.log('  ok отказы подряд: серия прерывается выходом, пропуск не отказ');

/* ---- 4. Три отказа — сигнал ---- */

assert.equal(REFUSAL_ALERT, 3, 'порог не три: либо тревога из-за одного отказа, либо незамеченный третий');
const alert = hintFor(0, 3);
assert.equal(alert.needsTalk, true, 'три отказа не требуют разговора');
assert.ok(/разговор/i.test(alert.headline), `подсказка при трёх отказах не про разговор: ${alert.headline}`);
assert.ok(AFTER_THREE_REFUSALS.length >= 4, 'нет порядка разговора после трёх отказов');

// Один отказ — ещё не сигнал.
assert.equal(hintFor(0, 1).needsTalk, false, 'один отказ поднял тревогу');
console.log('  ok три отказа — разговор, один — норма');

/* ---- 5. Приёмы: есть что делать на каждом уровне ---- */

assert.ok(ANXIOUS_TECHNIQUES.length >= 5, `приёмов ${ANXIOUS_TECHNIQUES.length}, нужно не меньше 5`);
for (const technique of ANXIOUS_TECHNIQUES) {
  assert.ok(technique.do.length > 20, `приём «${technique.title}» без действия`);
  assert.ok(technique.why.length > 20, `приём «${technique.title}» без объяснения, почему работает`);
}
for (const level of [undefined, 0, 1, 2] as const) {
  const hint = hintFor(level);
  assert.ok(hint.technique, `для уровня ${level} нет приёма`);
  assert.ok(hint.avoid, `для уровня ${level} нет запрещённой фразы`);
  assert.ok(hint.headline.length > 10, `для уровня ${level} нет подсказки`);
}
console.log('  ok приём и запрет есть на каждом уровне');

/* ---- 6. Запрещённые фразы: у каждой есть замена ---- */

assert.ok(PHRASES_TO_AVOID.length >= 5, `запрещённых фраз ${PHRASES_TO_AVOID.length}, нужно не меньше 5`);
for (const item of PHRASES_TO_AVOID) {
  assert.ok(item.instead.length > 10, `у фразы «${item.phrase}» нет замены`);
  assert.ok(item.effect.length > 30, `у фразы «${item.phrase}» нет объяснения вреда`);
}
console.log('  ok у каждой запрещённой фразы есть замена и причина');

/* ---- 7. Ни медицины, ни принуждения ---- */

const text = JSON.stringify([STAGE_LADDER, ANXIOUS_TECHNIQUES, PHRASES_TO_AVOID, AFTER_THREE_REFUSALS, hintFor(0, 3)]);

const medical = [/терапи/i, /коррекц/i, /диагноз/i, /расстройств/i, /лечени/i, /психиатр/i, /клиническ/i];
for (const re of medical) {
  assert.ok(!re.test(text), `в методике медицинское слово: ${re}`);
}

/**
 * Принуждение проверяем по обращению к ребёнку, а не по корню слова.
 *
 * «Создаёт обязанность ответить» — это описание того, почему фраза вредит, то
 * есть правильный текст. Проверка на `обязан` запрещала бы объяснение. Поэтому
 * ищем только обращение: «ты обязан», «ты должен», «смелее, давай».
 */
const pressure = [
  /\bты (обязан|должен)\b/iu,
  /\bвсе уже\b/iu,
  /\bа ты\?/iu,
  /\bдавай[,!]? смелее/iu,
  /\bстыдно\b/iu,
];
for (const re of pressure) {
  assert.ok(!re.test(text), `в методике давление на ребёнка: ${re}`);
}
console.log('  ok ни медицинских слов, ни принуждения');

console.log('\nЛестница выхода: четыре ступени, приёмы вместо уговоров, без медицины.');
