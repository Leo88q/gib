/**
 * Разметка компетенций: история должна принадлежать той компетенции, о
 * которой она на самом деле.
 *
 * Зачем отдельный тест. Компетенция истории управляет тремя вещами: на какой
 * квест её ставит движок, в какую тему карты она попадает у ребёнка и что
 * напишет родитель в отчёте. Если история про поддержку друга помечена как
 * «самопознание», то ребёнок видит её не в той теме, а родитель — не тот
 * прогресс. Ошибка не падает и не выглядит ошибкой: всё работает и врёт.
 *
 * Проверка опирается на карту «история → навыки»: навык всегда принадлежит
 * ровно одной компетенции. Если все навыки истории принадлежат одной
 * компетенции, а сама история помечена другой — это расхождение.
 *
 * Правило осознанно мягкое: расхождение допускается, когда история тренирует
 * навыки двух компетенций (так бывает: «предложить помощь» и «уважать отказ»
 * живут в одной сцене). Тогда компетенция выбирается по первому навыку, и
 * тест это принимает.
 */
import assert from 'node:assert/strict';
import { PROGRAM, PROGRAM_SCENARIOS, scenarioOfProgramDay } from '../lib/content/program/index.ts';
import { STORYLETS_BY_ID } from '../lib/content/storylets.ts';
import { STORY_SKILLS } from '../lib/content/story-skills.ts';
import { SKILL_BY_ID } from '../lib/content/skills-catalog.ts';
import { DAY_STORY_CARDS } from '../lib/day/story-deck.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import type { CompetencyId } from '../lib/types.ts';

const declared = new Map<string, CompetencyId>();
for (const scenario of PROGRAM_SCENARIOS) declared.set(scenario.id, scenario.competency);
for (const storylet of Object.values(STORYLETS_BY_ID)) declared.set(storylet.id, storylet.competency);

const mismatched: { storyId: string; has: CompetencyId; expected: CompetencyId; skills: string[] }[] = [];
const multiCompetency: string[] = [];

for (const [storyId, entry] of Object.entries(STORY_SKILLS)) {
  const has = declared.get(storyId);
  if (!has) continue;
  const competencies = new Set(entry.skills.map(skillId => SKILL_BY_ID[skillId]?.competency).filter(Boolean));
  if (competencies.size === 0) continue;
  const expected = SKILL_BY_ID[entry.skills[0]]!.competency;
  // История тренирует навыки двух и более компетенций — одна метка неизбежно
  // неточна. Такие истории перечисляем, но не считаем ошибкой.
  if (competencies.size > 1) { multiCompetency.push(storyId); continue; }
  if (has !== expected) mismatched.push({ storyId, has, expected, skills: entry.skills });
}

assert.deepEqual(
  mismatched.map(item => `${item.storyId}: стоит ${item.has}, по навыкам ${item.expected} (${item.skills.join(', ')})`),
  [],
  'компетенция истории расходится с её навыками',
);

console.log(`  ok компетенции историй совпадают с их навыками (проверено ${Object.keys(STORY_SKILLS).length})`);
if (multiCompetency.length) {
  console.log(`  ok истории на стыке двух компетенций: ${multiCompetency.length} (${multiCompetency.join(', ')})`);
}

/* ---- Сцена дня: карточка есть и её компетенция честная ---- */
{
  // Карточка дня может относиться к другой компетенции, чем основная история
  // дня: ребёнок выбирает одну из двух, и тема — та, что он выбрал. Но у
  // каждого дня обязана быть вторая история, иначе выбор исчезает.
  const byDay = new Map<number, string[]>();
  for (const card of DAY_STORY_CARDS) {
    byDay.set(card.dayIndex, [...(byDay.get(card.dayIndex) ?? []), card.scenarioId]);
  }
  const emptyDays: number[] = [];
  for (const day of PROGRAM_DAYS) {
    if ((byDay.get(day.index) ?? []).length === 0) emptyDays.push(day.index);
  }
  assert.deepEqual(emptyDays, [], 'дни без выбора истории: ребёнок не сможет выбрать карточку');

  // Компетенция карточки должна быть заявлена и известна — никаких пустых.
  const all: Record<string, { competency: CompetencyId }> = { ...Object.fromEntries(PROGRAM_SCENARIOS.map(s => [s.id, s])), ...STORYLETS_BY_ID };
  const bad: string[] = [];
  for (const card of DAY_STORY_CARDS) {
    const scenario = all[card.scenarioId];
    if (!scenario || !scenario.competency) bad.push(`${card.id}: нет компетенции`);
  }
  assert.deepEqual(bad, [], 'у карточки дня нет компетенции');
  console.log(`  ok у всех ${PROGRAM_DAYS.length} дней есть выбор истории, у ${DAY_STORY_CARDS.length} карточек заявлена компетенция`);
}

/* ---- Неделя и её дни: метка недели не обещает того, чего в днях нет ---- */
{
  // Компетенция недели — это то, что видит родитель на карточке недели.
  // Пять дней могут задевать соседние компетенции, но заявленная должна быть
  // в них самой частой: иначе ярлык обещает тему, которой в историях нет.
  // Так нашлась неделя 8: «Память» стояла как «Самопознание», а все пять её
  // дней были про решения — ни одного про свои чувства.
  const wrong: string[] = [];
  for (const week of PROGRAM) {
    const counts = new Map<CompetencyId, number>();
    for (const day of PROGRAM_DAYS.filter(d => d.week.week === week.week)) {
      const competency = scenarioOfProgramDay(day.index).competency;
      counts.set(competency, (counts.get(competency) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[0] !== week.competency) {
      wrong.push(`неделя ${week.week}: заявлено «${week.competency}», в днях чаще «${top?.[0] ?? '—'}»`);
    }
  }
  assert.deepEqual(wrong, [], `компетенция недели расходится с её днями: ${wrong.join('; ')}`);
  console.log(`  ok ${PROGRAM.length} недель: заявленная компетенция совпадает с самой частой в днях`);
}

console.log('\nРазметка компетенций: история и её навыки говорят одно и то же.');