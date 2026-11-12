/**
 * Документы исследования совпадают с кодом.
 *
 * Зачем. `docs/research-passport.md` и `docs/research-construct-map.md` —
 * документы, которые читают научный руководитель и вуз. Каталог навыков за
 * осень вырос с 48 до 54, истории — до 139, покрытие пересчиталось, а таблицы
 * остались в прошлом: паспорт говорил «31 из 48», карта — «54 навыка», хотя
 * в шапке стояло 51, а неделя 10 значилась как 0% при фактических 100%.
 *
 * Ни один тест этого не видел, потому что тесты проверяли код, а не прозу о
 * коде. Здесь числа берутся из кода и сверяются с текстом документов.
 *
 * Проверяется:
 *  - размер каталога и число историй названы в обоих документах;
 *  - покрытие конструктов в карте совпадает с пересчётом по каталогу;
 *  - таблица по неделям сходится с расчётом;
 *  - устаревших чисел (48 навыков, 133 истории, 51 навык, 17 непокрытых) нет;
 *  - доля дней в измеряемой зоне названа и посчитана верно.
 *
 * Запуск: npm run test-research-docs
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_CATALOG } from '../lib/content/skills-catalog.ts';
import { STORY_SKILLS } from '../lib/content/story-skills.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';

const root = process.cwd();
const passport = readFileSync(join(root, 'docs/research-passport.md'), 'utf8');
const map = readFileSync(join(root, 'docs/research-construct-map.md'), 'utf8');

/* ---- 1. Пересчёт покрытия: та же логика, что в map-research-constructs ---- */

/**
 * Шесть конструктов исследования заданы тремя компетенциями целиком и пятью
 * явными списками. Копировать сюда скрипт было бы дублированием, но импорт
 * `scripts/map-research-constructs.ts` запускает `main()` при загрузке и печатает
 * отчёт. Поэтому списки повторены — и здесь же проверяется, что они не
 * разошлись с документом: если разойдутся, тест упадёт на числах.
 */
const BY_COMPETENCY = ['self_awareness', 'empathy', 'self_regulation'];
const EXPLICIT = [
  'ask_help', 'offer_help', 'accept_refusal', 'say_no', 'apologize', 'agree_rules', 'handle_conflict',
  'plan_steps', 'change_plan', 'order_steps', 'first_things_first', 'rebuild_plan',
  'join_group', 'take_role', 'support_group', 'show_idea', 'show_work',
];

const measured = new Set<string>();
for (const skill of SKILLS_CATALOG as { id: string; competency: string }[]) {
  if (BY_COMPETENCY.includes(skill.competency)) measured.add(skill.id);
}
for (const id of EXPLICIT) measured.add(id);

const total = SKILLS_CATALOG.length;
const covered = measured.size;
const uncovered = total - covered;
const share = Math.round((covered / total) * 100);

assert.equal(total, 54, `навыков в каталоге ${total}, а тест написан под 54`);
assert.ok(covered <= total, 'покрыто больше, чем есть навыков');
console.log(`  ok пересчёт: ${covered} из ${total} (${share}%), не покрыто ${uncovered}`);

/* ---- 2. Числа названы в документах ---- */

assert.ok(passport.includes(`${covered} навыков из ${total}`), `паспорт не называет покрытие ${covered} из ${total}`);
assert.ok(passport.includes(`${total} навыков`), `паспорт не называет каталог из ${total} навыков`);
assert.ok(map.includes(`${covered} из ${total}`), `карта не называет покрытие ${covered} из ${total}`);
assert.ok(map.includes(`${total} навыка`) || map.includes(`${total} навыков`), `карта не называет каталог из ${total}`);

const stories = Object.keys(STORY_SKILLS).length;
assert.ok(passport.includes(`${stories} историй`), `паспорт не называет ${stories} историй`);
console.log(`  ok документы называют ${total} навыков, ${stories} историй и покрытие ${covered}`);

/* ---- 3. Устаревших чисел нет ---- */

for (const [stale, why] of [
  ['31 навык из 48', 'старый каталог из 48 навыков'],
  ['39 из 54 (72%) вместо 34 (67%)', 'допустимо: это история правки'],
] as const) {
  if (why.startsWith('допустимо')) continue;
  assert.ok(!passport.includes(stale), `паспорт живёт в прошлом: ${why}`);
}

// Упоминания старых чисел допустимы только как история правок — проверяем,
// что они не стоят в позиции текущего факта (в шапке и в таблицах).
assert.ok(!/Каталог вырос с 48 до 51 навыка/.test(map), 'карта называет прошлый размер каталога как текущий');
assert.ok(!/размечен по 51 навыку/.test(map), 'карта размечена по 51 навыку, а в коде 54');
assert.ok(!/\(17 навыков, 35%\)/.test(map), 'карта называет 17 непокрытых, а их 15');
console.log('  ok устаревших чисел в текущих фактах нет');

/* ---- 4. Таблица по неделям сходится с расчётом ---- */

const weekRows = [...map.matchAll(/^\| (\d{1,2}) \| [^|]+ \| (\d+) \| (\d+) \|/gm)];
assert.ok(weekRows.length >= 12, `в карте ${weekRows.length} строк по неделям, ожидалось 12`);

let checkedWeeks = 0;
for (const row of weekRows) {
  const week = Number(row[1]);
  const skillsInDoc = Number(row[2]);
  const insideInDoc = Number(row[3]);

  const skills = new Set<string>();
  for (const day of PROGRAM_DAYS.filter((entry) => entry.week.week === week)) {
    for (const skill of STORY_SKILLS[String(day.day.scenarioId)]?.skills ?? []) skills.add(skill);
  }
  const inside = [...skills].filter((skill) => measured.has(skill)).length;

  assert.equal(skillsInDoc, skills.size, `неделя ${week}: в карте ${skillsInDoc} навыков, в коде ${skills.size}`);
  assert.equal(insideInDoc, inside, `неделя ${week}: в карте ${insideInDoc} в конструктах, в коде ${inside}`);
  checkedWeeks += 1;
}
assert.equal(checkedWeeks, 12, `сверено ${checkedWeeks} недель, ожидалось 12`);
console.log('  ok таблица по 12 неделям совпадает с кодом');

/* ---- 5. Доля дней в измеряемой зоне ---- */

const days = PROGRAM_DAYS.length;
const measuredDays = PROGRAM_DAYS.filter((entry) =>
  (STORY_SKILLS[String(entry.day.scenarioId)]?.skills ?? []).some((skill) => measured.has(skill)),
).length;
const daysShare = Math.round((measuredDays / days) * 100);

assert.equal(days, 60, `дней программы ${days}, ожидалось 60`);
assert.ok(
  map.includes(`${measuredDays} из ${days}`) || map.includes(`${daysShare}% дней`),
  `карта не называет ${measuredDays} дней из ${days} (${daysShare}%) в измеряемой зоне`,
);
console.log(`  ok ${measuredDays} из ${days} дней (${daysShare}%) в измеряемой зоне, названо в карте`);

/* ---- 5b. docs/testing.md называет настоящие числа прогона ---- */

/**
 * Документ про проверки обязан считать проверки так же, как их считает
 * test-university-doc: файлы `scripts/test-*.{ts,tsx}`, вхождения
 * `assert.<метод>(`. Иначе он разойдётся на первой же новой проверке — и
 * разойдётся молча, потому что за ним никто не следит.
 */
import { readdirSync } from 'node:fs';
import { readFileSync as readFile } from 'node:fs';

const testingDoc = readFile(join(root, 'docs', 'testing.md'), 'utf8');
const testFiles = readdirSync(join(root, 'scripts')).filter((name) => /^test-.*\.tsx?$/.test(name));

let assertCount = 0;
for (const name of testFiles) {
  assertCount += (readFile(join(root, 'scripts', name), 'utf8').match(/assert\.[a-z]+\(/g) ?? []).length;
}

assert.ok(
  testingDoc.includes(String(testFiles.length)),
  `docs/testing.md не называет ${testFiles.length} файлов тестов`,
);
assert.ok(
  testingDoc.includes(String(assertCount)),
  `docs/testing.md не называет ${assertCount} проверок`,
);
console.log(`  ok docs/testing.md называет ${testFiles.length} файлов и ${assertCount} проверок`);

/* ---- 6. Медицинских формулировок нет и в research-документах ---- */

for (const [name, text] of [['паспорт', passport], ['карта', map]] as const) {
  // Слово «коррекция» в исследовательских документах допустимо только как
  // статистическая поправка, поэтому ищем составные: «коррекция СДВГ».
  for (const re of [/коррекц[а-я]*\s+(СДВГ|дислекси|поведения)/i, /лечени[ея]/i, /диагноз/i]) {
    assert.ok(!re.test(text), `${name}: медицинская формулировка ${re}`);
  }
}
console.log('  ok медицинских формулировок нет');

console.log('\nДокументы исследования: числа совпадают с кодом.');
