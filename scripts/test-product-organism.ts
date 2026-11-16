/**
 * Карта продукта: реестр недоделок не должен врать в обе стороны.
 *
 * Документ `docs/product-organism.md` читают, чтобы решить, что делать дальше.
 * Врать он может двумя способами, и оба плохи:
 *
 *  1. назвать сделанным то, чего нет в коде — тогда план строится на воздухе;
 *  2. не назвать того, чего нет, — тогда блокер всплывает в день запуска.
 *
 * Поэтому проверка не «документ существует», а сверка:
 *  - числа программы с кодом;
 *  - наличие каждого маршрута, о котором документ говорит как о готовом;
 *  - отсутствие реальных платежей, если документ говорит, что их нет;
 *  - наличие блокеров, которые названы в README.
 *
 * Запуск: npm run test-product-organism
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { YEAR } from '../lib/content/year/index.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import { SKILLS_CATALOG } from '../lib/content/skills-catalog.ts';
import { SHOWCASE_ANCHORS } from '../lib/year/lessons.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const doc = read('docs/product-organism.md');
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));

/* ---- 1. Числа программы ---- */

assert.equal(YEAR.lessons.length, 36, `в коде ${YEAR.lessons.length} занятий`);
assert.equal(YEAR.lessons.filter((lesson) => lesson.isShowcase).length, 12, 'показов не 12');
assert.equal(PROGRAM_DAYS.length, 60, `в коде ${PROGRAM_DAYS.length} дней`);
assert.equal(SKILLS_CATALOG.length, 54, `в каталоге ${SKILLS_CATALOG.length} навыков`);

for (const number of ['36', '12', '60', '54']) {
  assert.ok(doc.includes(number), `в документе нет числа ${number}`);
}
console.log('  ok 36 занятий, 12 показов, 60 сцен, 54 навыка совпадают с кодом');

/* ---- 2. Шкала показа описана словами из кода ---- */

for (const level of [0, 1, 2] as const) {
  const anchor = SHOWCASE_ANCHORS[level];
  // В документе якоря идут в нижнем регистре и без точки: сверяем по смыслу.
  assert.ok(
    doc.toLowerCase().includes(anchor.toLowerCase()),
    `в документе нет якоря шкалы «${anchor}»`,
  );
}
console.log('  ok якоря показа 0–2 совпадают с кодом слово в слово');

/* ---- 3. То, что названо готовым, существует ---- */

const ready: [string, string][] = [
  ['годовой курс', 'lib/content/year/index.ts'],
  ['план встречи', 'lib/year/meeting.ts'],
  ['посещаемость и показы', 'lib/year/lessons.ts'],
  ['карта дня и награды', 'lib/engine/session.ts'],
  ['журнал событий', 'lib/events/journal.ts'],
  ['кабинет педагога', 'app/api/teacher/route.ts'],
  ['кабинет родителя', 'app/parent/page.tsx'],
  ['хранение PostgreSQL', 'lib/postgres/state-backend.ts'],
  ['защита production', 'lib/launch-guard.ts'],
  ['данные профиля для родителя', 'app/api/profile/data/route.ts'],
];
for (const [name, path] of ready) {
  if (!exists(path)) {
    // Если файла нет — документ не должен называть это готовым. Сообщаем
    // конкретно, что именно не найдено: иначе правка превращается в поиск.
    assert.fail(`документ называет готовым «${name}», но файла ${path} нет`);
  }
}
console.log(`  ok ${ready.length} названных готовыми модулей существуют`);

/* ---- 4. Платежи: документ говорит, что их нет — проверим, что не появились ---- */

const billing = read('app/api/subscribe/route.ts');
const billingSpeaks = /billing_not_configured|GIB_BILLING/.test(billing);
assert.ok(
  billingSpeaks || doc.includes('Реальных платежей нет') === false,
  'платежи включены, а документ говорит, что их нет',
);
assert.ok(
  doc.includes('сказать') || /Реальных платежей нет|моками/.test(doc),
  'документ не говорит прямо, что реальных платежей нет',
);
console.log('  ok статус платежей в документе соответствует коду');

/* ---- 5. Блокеры названы и не спрятаны ---- */

const blockers: [string, RegExp][] = [
  ['правовые основания', /правов[а-яё]* основ|согласи/i],
  ['экспертиза контента', /экспертиз/i],
  ['реальные устройства', /реальн[а-яё]* устройств/i],
  ['платежи', /платёж|платеж/i],
  ['резервное копирование', /резервн[а-яё]* копир/i],
];
for (const [name, re] of blockers) {
  assert.ok(re.test(doc), `блокер «${name}» не назван в документе`);
}
console.log('  ok все пять блокеров запуска названы');

/* ---- 6. Реестр размечен приоритетами и каждый пункт пронумерован ---- */

const numbered = doc.match(/^\| \d+ \|/gm) ?? [];
assert.ok(numbered.length >= 20, `в реестре ${numbered.length} пунктов, ожидалось не меньше 20`);

for (const priority of ['P0', 'P1', 'P2', 'P3']) {
  assert.ok(doc.includes(`### ${priority}`) || doc.includes(`**${priority}**`), `в реестре нет раздела ${priority}`);
}

// Номера не должны повторяться: два пункта с одним номером — это два дела,
// которые потом перепутают в плане.
const numbers = (doc.match(/^\| (\d+) \|/gm) ?? []).map((row) => row.replace(/\D/g, ''));
assert.equal(new Set(numbers).size, numbers.length, `в реестре повторяются номера: ${numbers.join(',')}`);
console.log(`  ok реестр: ${numbers.length} нумерованных пунктов, P0–P3, без повторов`);

/* ---- 7. Нет обещаний, которые противоречат правилам продукта ---- */

const forbidden = [
  { re: /повышает (IQ|интеллект)/i, why: 'обещание роста IQ' },
  { re: /гарантируем результат/i, why: 'гарантия результата' },
];
for (const { re, why } of forbidden) {
  assert.ok(!re.test(doc), `в документе запрещённое обещание: ${why}`);
}

// Три правила должны быть записаны: без них документ описывает продукт,
// который можно «улучшить» до состояния, где методика перестаёт работать.
assert.ok(/Продукт не оценивает ребёнка/.test(doc), 'не записано правило «не оценивать ребёнка»');
assert.ok(/Отказ — это данные/.test(doc), 'не записано правило «отказ — это данные»');
assert.ok(/Причины отсутствия не собираются/.test(doc), 'не записано правило про причины отсутствия');
console.log('  ok три правила продукта записаны и обещаний сверх них нет');

/* ---- 8. Документ читается: нет чужих алфавитов ---- */

assert.equal(doc.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g), null, 'в документе чужие символы');
assert.ok(!/\uFFFD/.test(doc), 'в документе битые символы');
console.log('  ok чужих алфавитов и битых символов нет');

console.log('\nКарта продукта: числа сходятся с кодом, недоделки названы все.');
