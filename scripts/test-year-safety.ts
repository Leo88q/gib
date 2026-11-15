/**
 * Правила телесных упражнений.
 *
 * Зачем тест. Правило безопасности не проверяется глазами: если из протокола
 * пропадёт «спрашивать разрешение каждый раз», экран останется рабочим, тесты
 * типов пройдут, а на занятии взрослый будет водить детей за плечо без спроса.
 *
 * Второй риск — обратный. В разделе про безопасность легко появляются слова
 * «тревожный ребёнок», «коррекция», «норма»: они выглядят заботой, а на деле
 * превращают занятие в медицинскую процедуру. Тест держит границу с двух сторон.
 *
 * Проверяется:
 *  - у каждого правила есть действие и объяснение, а не лозунг;
 *  - правила сгруппированы по тому, что именно защищают (прикосновение, тело, группа);
 *  - темы с телесными упражнениями ссылаются на существующие правила;
 *  - в темах нет медицинских слов;
 *  - согласие спрашивается каждый раз, а не один раз за год.
 *
 * Запуск: npm run test-year-safety
 */

import { strict as assert } from 'node:assert';
import { PROGRAM } from '../lib/content/program/index.ts';
import {
  ALL_SAFETY_RULES,
  BODY_RULES,
  BODY_UNITS,
  GROUP_RULES,
  SAFETY_BY_ID,
  TOUCH_RULES,
  safetyForUnit,
} from '../lib/year/safety-body.ts';

/* ---- 1. Правила: действие и причина в каждом ---- */

assert.ok(ALL_SAFETY_RULES.length >= 9, `правил ${ALL_SAFETY_RULES.length}, ожидалось не меньше девяти`);
const ids = ALL_SAFETY_RULES.map((rule) => rule.id);
assert.equal(new Set(ids).size, ids.length, 'id правил повторяются');

for (const rule of ALL_SAFETY_RULES) {
  assert.ok(rule.title.length > 5, `правило «${rule.id}» без названия`);
  assert.ok(rule.do.length > 40, `правило «${rule.id}» без действия`);
  assert.ok(rule.why.length > 30, `правило «${rule.id}» без объяснения, почему так`);
  // Правило — это указание, а не пожелание.
  assert.ok(/[а-яё]/i.test(rule.do), `правило «${rule.id}» не на русском`);
}
console.log(`  ok ${ALL_SAFETY_RULES.length} правил: у каждого действие и причина`);

/* ---- 2. Три группы: прикосновение, тело, группа ---- */

assert.ok(TOUCH_RULES.length >= 3, 'про прикосновения меньше трёх правил');
assert.ok(BODY_RULES.length >= 3, 'про тело меньше трёх правил');
assert.ok(GROUP_RULES.length >= 3, 'про группу меньше трёх правил');

// Ключевое правило: согласие каждый раз. Оно не должно потеряться при правках.
const consent = TOUCH_RULES.find((rule) => /каждый раз/i.test(rule.title));
assert.ok(consent, 'пропало правило «спрашивать разрешение каждый раз»');
assert.ok(/согласие на занятие не равно/i.test(consent.why), 'правило согласия потеряло объяснение');

// Стоп-слово проверяют, а не обещают.
const stop = ALL_SAFETY_RULES.find((rule) => rule.id === 'stop-word');
assert.ok(stop, 'пропало стоп-слово');
assert.ok(/проверьте/i.test(stop.do), 'стоп-слово без проверки — это обещание, а не правило');
console.log('  ok прикосновение, тело и группа: по три правила, согласие — каждый раз');

/* ---- 3. Темы с телесными упражнениями ---- */

assert.ok(BODY_UNITS.length >= 4, `тем с телесными упражнениями ${BODY_UNITS.length}, ожидалось не меньше четырёх`);
for (const entry of BODY_UNITS) {
  assert.ok(entry.unit >= 1 && entry.unit <= PROGRAM.length, `тема ${entry.unit} вне программы`);
  assert.ok(entry.what.length > 25, `тема ${entry.unit}: не сказано, что именно требует правил`);
  assert.ok(entry.rules.length >= 2, `тема ${entry.unit}: одно правило — это не протокол`);
  for (const id of entry.rules) {
    assert.ok(SAFETY_BY_ID[id], `тема ${entry.unit}: правило «${id}» не существует`);
  }
  // Название темы в описании должно совпадать с программой: иначе список
  // останется про старый набор после переименования.
  const title = PROGRAM[entry.unit - 1].title;
  const firstWord = title.split(' ')[0].replace(/[«»]/g, '');
  assert.ok(entry.what.includes(firstWord), `тема ${entry.unit}: описание не упоминает «${firstWord}» — похоже, тема другая`);
}
console.log('  ok темы с телесными упражнениями ссылаются на существующие правила');

/* ---- 4. Нет медицинских слов и оценок ---- */

const text = JSON.stringify({ ALL_SAFETY_RULES, BODY_UNITS });
for (const bad of [/терапи/i, /коррекц/i, /диагноз/i, /тревожн[а-я]* ребёнк/i, /норма\b/i, /отклонен/i, /расстройств/i]) {
  assert.ok(!bad.test(text), `в правилах безопасности появилось: ${bad}`);
}
// «Молодец» и «правильно» в правилах безопасности — это оценка в месте, где
// ребёнок уже уязвим.
assert.ok(!/молодец|\bправильно\b/i.test(text), 'правила безопасности оценивают ребёнка');
console.log('  ok ни медицины, ни оценок');

/* ---- 5. Функция по теме ---- */

assert.equal(safetyForUnit(1), undefined, 'тема без телесных упражнений получила правила');
const first = BODY_UNITS[0];
const check = safetyForUnit(first.unit);
assert.ok(check, `тема ${first.unit}: правила не отдаются`);
assert.equal(check.rules.length, first.rules.length, `тема ${first.unit}: отдано не то число правил`);
assert.ok(check.rules.every((rule) => rule.do && rule.why), 'правило отдано без действия');
assert.equal(safetyForUnit(999), undefined, 'несуществующая тема получила правила');
console.log('  ok правила отдаются по теме и только там, где нужны');

console.log('\nБезопасность телесных упражнений: прикосновение, тело, группа.');
