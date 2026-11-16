/**
 * Полнота контента курса: каждый день написан, а не подставлен.
 *
 * Зачем тест. Контент заполнялся месяцами, и главная болезнь здесь не «нет
 * текста», а «текст есть, но один и тот же». Так и случилось: 45 дней подряд в
 * отчёте стояло одно предложение, у девяти тем были одинаковые идеи для дома, а
 * половина сцен не имела начала, поэтому приём «замри на пике» в половине
 * планов встреч просто отсутствовал. Ни одна из этих проблем не ломает сборку и
 * не видна в интерфейсе — её видно только при чтении подряд.
 *
 * Что проверяется:
 *  1. У всех 60 дней есть текст, название и три варианта в каждом возрасте.
 *  2. Тексты не повторяются между днями и различаются по возрастам.
 *  3. У каждого дня своё начало сцены и свой вопрос ребёнку.
 *  4. Родительские заметки к дням не повторяются.
 *  5. У каждой из 12 тем свои идеи для дома и свой вопрос.
 *  6. Ни в одном добавленном тексте нет оценки, медицины и обещаний.
 *  7. Планы встреч: 40 минут, своё начало сцены у каждой, без шаблонных блоков.
 *
 * Запуск: npm run test:course-complete
 */

import { strict as assert } from 'node:assert';
import { PROGRAM, PROGRAM_DAYS, SCENARIO_BY_ID, TOTAL_DAYS } from '../lib/content/program/index.ts';
import { FAMILY_PROMPTS } from '../lib/content/program/family-prompts.ts';
import { DAY_NOTES } from '../lib/content/program/day-notes.ts';
import { STORY_STARTS } from '../lib/content/program/story-starts.ts';
import { YEAR } from '../lib/content/year/index.ts';
import { meetingPlan, MEETING_MINUTES } from '../lib/year/meeting.ts';
import { REMAINING_DAYS } from '../lib/content/program/remaining-content.ts';

const check = (condition: unknown, message: string) => { assert.ok(condition, message); console.log('  ok', message); };
const bands = ['5-7', '8-10', '11-13'] as const;
const days = PROGRAM_DAYS.map(({ week, day }) => ({ week, day, scenario: SCENARIO_BY_ID[day.scenarioId] }));

/* ---- 1. Все дни написаны ---- */

check(days.length === TOTAL_DAYS && TOTAL_DAYS === 60, 'в курсе 60 дней практики');
check(days.every((d) => bands.every((band) => d.scenario.variants[band].text.length > 30)), 'у всех 60 дней есть текст ситуации во всех возрастах');
check(days.every((d) => bands.every((band) => d.scenario.variants[band].title.length > 3)), 'у всех 60 дней есть название для каждого возраста');
check(days.every((d) => bands.every((band) => d.scenario.variants[band].options.length === 3)), 'у каждого дня три варианта в каждом возрасте');

/* ---- 2. Тексты не повторяются ---- */

const texts = days.flatMap((d) => bands.map((band) => d.scenario.variants[band].text));
check(new Set(texts).size === texts.length, `тексты ситуаций уникальны: ${new Set(texts).size} из ${texts.length}`);
check(days.every((d) => new Set(bands.map((band) => d.scenario.variants[band].text)).size === 3), 'тексты различаются по возрастам в каждом дне');
check(days.every((d) => new Set(bands.map((band) => d.scenario.variants[band].title)).size === 3), 'названия различаются по возрастам в каждом дне');

const optionTexts = days.flatMap((d) => bands.flatMap((band) => d.scenario.variants[band].options.map((o) => o.text)));
const uniqueOptions = new Set(optionTexts);
/*
 * Вариант может повториться между двумя днями одной темы — «Попросить время
 * подумать» подходит и к приглашению, и к решению группы. Поэтому допускается
 * небольшой процент совпадений, но не общий шаблон.
 */
check(uniqueOptions.size >= optionTexts.length * 0.9, `варианты не шаблонные: ${uniqueOptions.size} уникальных из ${optionTexts.length}`);

/* ---- 3. Начало сцены и вопрос ребёнку ---- */

check(days.every((d) => bands.every((band) => Boolean(d.scenario.variants[band].start))), 'у всех 60 дней есть начало сцены во всех возрастах');
const starts = days.map((d) => d.scenario.variants['11-13'].start!);
check(new Set(starts).size === starts.length, 'начала сцен не повторяются между днями');
check(starts.every((start) => start.length > 15 && start.length < 130), 'начало сцены — короткое действие, а не абзац');
check(starts.every((start) => !start.trim().endsWith('?')), 'начало сцены — действие, а не вопрос');

const dailyQuestions = days.map((d) => d.scenario.question ?? '');
check(dailyQuestions.every((q) => q.endsWith('?')), 'у каждого дня есть вопрос, а не заглушка');
check(new Set(dailyQuestions).size === dailyQuestions.length, 'вопрос дня не повторяется: иначе ведущий читает одно и то же');
check(days.every((d) => !/Что можно выбрать\?$/.test(d.scenario.variants['8-10'].text)), 'текст не заканчивается общим «Что можно выбрать?» у всех подряд');

/* ---- 4. Родительские заметки к дням ---- */

const homes = days.map((d) => d.scenario.home ?? '');
const reports = days.map((d) => d.scenario.report ?? '');
const growths = days.map((d) => d.scenario.growth ?? '');
check(homes.every((value) => value.length > 20), 'у каждого дня есть предложение для дома');
check(new Set(homes).size === homes.length, `предложения для дома не повторяются: ${new Set(homes).size} из ${homes.length}`);
check(new Set(reports).size === reports.length, 'строки отчёта не повторяются');
check(new Set(growths).size === growths.length, 'памятки ведущему не повторяются');
check(Object.keys(DAY_NOTES).length === Object.keys(REMAINING_DAYS).length, 'заметки есть у всех дней, которым они нужны');

/* ---- 5. Темы ---- */

check(new Set(PROGRAM.map((week) => JSON.stringify(week.homeIdeas))).size === PROGRAM.length, `у каждой из ${PROGRAM.length} тем свои идеи для дома`);
check(new Set(PROGRAM.map((week) => week.weekQuestion)).size === PROGRAM.length, 'у каждой темы свой вопрос недели');
check(new Set(PROGRAM.map((week) => week.subtitle)).size === PROGRAM.length, 'у каждой темы свой подзаголовок');
check(Object.keys(FAMILY_PROMPTS).length === PROGRAM.length - 3, 'свои родительские тексты написаны для тем 4–12');
check(PROGRAM.every((week) => week.homeIdeas.length === 3), 'идей для дома по три на тему, как обещано');
check(PROGRAM.every((week) => week.homeIdeas.every((idea) => idea.length > 20)), 'идея для дома — фраза, а не слово');

/* ---- 6. Тон ---- */

const added = [
  ...Object.values(FAMILY_PROMPTS).flatMap((p) => [p.subtitle, p.parentNote, p.weekQuestion, ...p.homeIdeas]),
  ...Object.values(DAY_NOTES).flatMap((n) => [n.ask, n.home, n.report, n.growth, n.question, n.practiceWhy]),
  ...Object.values(STORY_STARTS).flat(),
  ...days.flatMap((d) => bands.map((band) => d.scenario.variants[band].text)),
].join(' ');

const BANNED: [RegExp, string][] = [
  [/диагност|терапи|коррекц|лечени/i, 'медицинское слово'],
  [/повышает успеваемость|поднимает оценки|рост IQ/i, 'обещание результата'],
  [/гарантиру/i, 'гарантия'],
  [/не справился|правильный ответ|твоя оценка|ваша оценка/i, 'оценка ребёнка'],
  [/обязательн[оа] (нужно|должен|должна)/i, 'обязанность вместо предложения'],
];
for (const [pattern, why] of BANNED) check(!pattern.test(added), `в добавленных текстах нет: ${why}`);

check(/Можно|Если .*захочет|Если хочется/i.test(Object.values(DAY_NOTES).map((n) => n.home).join(' ')), 'предложения для дома сформулированы как предложение');

/* ---- 7. Планы встреч ---- */

const plans = YEAR.lessons.map((lesson) => meetingPlan(lesson));
check(plans.every((plan) => plan.blocks.reduce((sum, block) => sum + block.minutes, 0) === MEETING_MINUTES), `каждый план — ${MEETING_MINUTES} минут`);
check(new Set(plans.map((plan) => plan.blocks.map((b) => b.lead + b.children).join('~'))).size === plans.length, 'тексты планов встреч не повторяются');
check(plans.every((plan) => Boolean(plan.freeze)), 'приём «замри на пике» есть в каждом плане: начало сцены написано для всех дней');
check(new Set(plans.map((plan) => plan.freeze!.start)).size === plans.length, 'начало сцены в планах не повторяется');
check(plans.every((plan) => plan.blocks[3].lead.includes(plan.freeze!.start)), 'начало сцены попало в блок практики');
check(new Set(plans.map((plan) => plan.closing)).size >= 12, 'закрывающая фраза меняется от темы к теме');

console.log('\nКонтент курса: 60 дней написаны, темы различаются, тон без оценок и обещаний.');
