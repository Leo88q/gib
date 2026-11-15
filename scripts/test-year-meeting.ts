/**
 * План встречи: 40 минут, из готового контента, без родительских текстов.
 *
 * Что проверяется и почему именно это:
 *  1. Минуты складываются в 40 на всех 36 занятиях. 45 вместо 40 ломают
 *     школьное расписание, а педагог узнаёт об этом на встрече.
 *  2. В плане нет оценок: ни «молодец», ни «правильно», ни баллов.
 *  3. Родительские тексты не утекают детям. `weekQuestion` говорит о ребёнке в
 *     третьем лице, `homeIdeas` — совет родителю. Задать это кругу детей —
 *     значит обсуждать ребёнка при нём.
 *  4. Показ — приглашение, а не требование.
 *  5. Причина отсутствия не собирается и здесь.
 *  6. Идентификаторы заданий не показываются: педагог видит «Цвет слова», а не
 *     `stroop`.
 *
 * Запуск: npm run test:year-meeting
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { SCENARIO_BY_ID, PROGRAM_DAYS, weekByNumber } from '../lib/content/program/index.ts';
import { MEETING_MINUTES, meetingPlan } from '../lib/year/meeting.ts';

/* ---- 1. Минуты на всех 36 занятиях ---- */

assert.equal(YEAR.lessons.length, 36, `в году ${YEAR.lessons.length} занятий, ожидалось 36`);

for (const lesson of YEAR.lessons) {
  const plan = meetingPlan(lesson);
  const total = plan.blocks.reduce((sum, block) => sum + block.minutes, 0);
  assert.equal(total, MEETING_MINUTES, `занятие ${lesson.number}: ${total} минут вместо ${MEETING_MINUTES}`);
  assert.equal(plan.blocks.length, 5, `занятие ${lesson.number}: ${plan.blocks.length} блоков, ожидалось 5`);
  assert.ok(plan.blocks.every((block) => block.minutes > 0), `занятие ${lesson.number}: блок с нулём минут`);
  assert.ok(plan.blocks.every((block) => block.lead.trim().length > 20), `занятие ${lesson.number}: пустое указание педагогу`);
}
console.log('  ok 36 занятий по 40 минут, у каждого блока есть указание');

/* ---- 2. Нет оценок и соревнования ---- */

/**
 * Запрещённые формулировки — утверждения об оценивании, а не корни слов.
 *
 * Проверка на «оценк» падает на фразе «это игра, а не оценка упорства» — то
 * есть на правильном тексте. Такая же ловушка была с «не оценка ребёнка».
 * Поэтому ищем не слово, а конструкцию: «ты молодец», «получил баллы»,
 * «хорошо справился». Это третий случай на один класс ошибки, и он записан в
 * docs/program-year-design.md.
 */
const BANNED = [
  /ты молодец/i,
  /получил \d+ балл/i,
  /\bбаллы за\b/i,
  /рейтинг (детей|группы|класса)/i,
  /лучший (ребёнок|ученик|в группе)/i,
  /(твоя|ваша) оценка/i,
  /правильный ответ/i,
  /не справился/i,
  /справился хуже/i,
];
for (const lesson of YEAR.lessons) {
  const plan = meetingPlan(lesson);
  const text = JSON.stringify(plan);
  for (const re of BANNED) {
    assert.ok(!re.test(text), `занятие ${lesson.number}: план оценивает детей (${re})`);
  }
}
console.log('  ok ни оценок, ни рейтинга, ни «не справился»');

/* ---- 3. Родительские тексты не утекают детям ---- */

// Все вопросы недели и советы родителю: они не должны попасть в планы вообще.
const parentOnly: string[] = [];
for (let unit = 1; unit <= 12; unit += 1) {
  const week = weekByNumber(unit);
  parentOnly.push(week.weekQuestion, week.parentNote, ...week.homeIdeas);
}

for (const lesson of YEAR.lessons) {
  const text = JSON.stringify(meetingPlan(lesson));
  for (const phrase of parentOnly) {
    if (phrase.length < 30) continue; // короткие фразы могут совпасть случайно
    assert.ok(!text.includes(phrase), `занятие ${lesson.number}: в план попал родительский текст «${phrase.slice(0, 40)}…»`);
  }
}
console.log('  ok родительские тексты в план встречи не попали');

/* ---- 4. Вопрос детям — из сценария, а не о ребёнке ---- */

for (const lesson of YEAR.lessons) {
  const plan = meetingPlan(lesson);
  const practice = plan.blocks[3].lead;
  const scenarioQuestions = lesson.dayIndexes
    .map((index) => PROGRAM_DAYS[index])
    .filter(Boolean)
    .map((entry) => SCENARIO_BY_ID[entry.day.scenarioId]?.question)
    .filter(Boolean);

  if (scenarioQuestions.length > 0) {
    const used = scenarioQuestions.some((question) => practice.includes(question));
    assert.ok(used, `занятие ${lesson.number}: в практике нет вопроса ни одного сценария`);
  }
}
console.log('  ok практика в парах построена на вопросе сценария');

/* ---- 5. Показ — приглашение ---- */

const showcase = YEAR.lessons.filter((lesson) => lesson.isShowcase);
assert.equal(showcase.length, 12, `в году ${showcase.length} показов, ожидалось 12`);
for (const lesson of showcase) {
  const plan = meetingPlan(lesson);
  const block = plan.blocks[1];
  assert.ok(/пригласите/i.test(block.lead), `занятие ${lesson.number}: показ не приглашение`);
  assert.ok(/не выходит|по желанию/i.test(block.children), `занятие ${lesson.number}: показ без права не выходить`);
  assert.ok(!plan.blocks.some((item) => item.title.includes('Разбор')), `занятие ${lesson.number}: в показе остался разбор`);
}
console.log('  ok 12 показов, каждый — приглашение с правом не выходить');

/* ---- 6. Нет причины отсутствия и нет бумажных карточек ---- */

const first = meetingPlan(YEAR.lessons[0]);
const firstText = JSON.stringify(first);
assert.ok(!/причин/i.test(firstText), 'план собирает причину отсутствия');
assert.ok(
  first.materials.some((item) => /приложени/i.test(item)),
  'материалы не указывают, что задания в приложении',
);
assert.ok(
  !first.materials.some((item) => /карточк/i.test(item)),
  'материалы обещают бумажные карточки, которых не существует',
);
console.log('  ok причины отсутствия нет, материалы честные');

/* ---- 7. Педагогу не показывают идентификаторы ---- */

for (const lesson of YEAR.lessons) {
  const plan = meetingPlan(lesson);
  const text = JSON.stringify(plan);
  assert.ok(!/stroop|go-nogo|memory-grid|digit-span|symbol-memory|find-diff|find-match|rule-switch|switch-rounds|plan-order/i.test(text),
    `занятие ${lesson.number}: в план попал идентификатор задания вместо названия`);
}
console.log('  ok задания названы по-человечески');

/* ---- 8. Этап года: вопрос круга меняется, а не повторяется ---- */

const opening = meetingPlan(YEAR.lessons[0]);
const middle = meetingPlan(YEAR.lessons[Math.ceil(YEAR.lessons.length / 2) - 1]);
const closing = meetingPlan(YEAR.lessons[YEAR.lessons.length - 1]);

assert.equal(opening.stage.id, 'opening', 'первое занятие года не помечено входом');
assert.equal(closing.stage.id, 'closing', 'последнее занятие года не помечено итогом');
assert.equal(middle.stage.id, 'middle', 'середина года не помечена серединой');

// Первый и последний круг года обязаны отличаться от обычного: иначе этап
// существует только в данных, а дети слышат одну и ту же фразу 36 раз.
assert.notEqual(opening.blocks[0].lead, middle.blocks[0].lead, 'вход года спросил то же, что и обычная встреча');
assert.notEqual(closing.blocks[0].lead, middle.blocks[0].lead, 'итог года спросил то же, что и обычная встреча');
assert.ok(opening.blocks[0].lead.includes(opening.stage.question), 'в круге входа нет вопроса этапа');
assert.ok(closing.blocks[0].lead.includes(closing.stage.question), 'в круге итога нет вопроса этапа');

// Этап не выдумывает новых минут и блоков.
assert.equal(opening.blocks.reduce((sum, block) => sum + block.minutes, 0), MEETING_MINUTES);
console.log('  ok этап года меняет вопрос круга на входе и итоге');

/* ---- 9. Присловье встречи: есть, где есть, и не подменяется выдумкой ---- */

const framed = YEAR.lessons.map((lesson) => ({ lesson, plan: meetingPlan(lesson) })).filter((item) => item.plan.frame);
assert.equal(framed.length, 12, `присловье есть у ${framed.length} занятий, ожидалось 12 (по одному на тему)`);
for (const { lesson, plan } of framed) {
  const text = plan.frame!;
  assert.ok(text.length > 15, `занятие ${lesson.number}: присловье короче фразы`);
  assert.ok(text.length < 130, `занятие ${lesson.number}: присловье не помещается на лист`);
  // Присловье — разрешение, а не требование и не обещание результата.
  assert.ok(!/должен|обязан|нужно обязательно|молодец|\bправильн/i.test(text),
    `занятие ${lesson.number}: присловье требует или оценивает`);
}
// На каждой теме ровно один вход в тему — и у него есть присловье.
const firsts = YEAR.lessons.filter((lesson) => lesson.inUnit === 1);
assert.equal(firsts.filter((lesson) => meetingPlan(lesson).frame).length, firsts.length,
  'у какой-то темы нет присловья на первом занятии');
console.log('  ok присловье: 12 тем, без требований и оценок');

/* ---- 10. Телесные упражнения: правила там, где они нужны ---- */

for (const lesson of YEAR.lessons) {
  const plan = meetingPlan(lesson);
  if (plan.safety) {
    assert.ok(plan.safety.rules.length >= 2, `занятие ${lesson.number}: одно правило — это не протокол`);
    for (const rule of plan.safety.rules) {
      assert.ok(rule.do.length > 30, `занятие ${lesson.number}: правило «${rule.title}» без действия`);
      assert.ok(rule.why.length > 20, `занятие ${lesson.number}: правило «${rule.title}» без объяснения`);
    }
  }
}
// Правила безопасности не должны превратиться в медицинский текст.
const safetyText = JSON.stringify(YEAR.lessons.map((lesson) => meetingPlan(lesson).safety ?? null));
assert.ok(!/терапи|коррекц|диагноз|тревожност[ьи] ребёнка/i.test(safetyText), 'в правилах безопасности появилась медицина');
console.log('  ok правила телесных упражнений: действие и причина в каждом');

console.log('\nПлан встречи: 40 минут, из готового контента, без родительских текстов.');
