import type { Scenario } from '../softskills';
import type { DayPlan, WeekPlan } from './types';
import { WEEKS_NINE_TWELVE_STORY_OPTIONS } from './weeks-nine-twelve-story-options.ts';
import { WEEKS_SIX_EIGHT_STORY_OPTIONS } from './weeks-six-eight-story-options.ts';
import { WEEKS_FOUR_FIVE_STORY_OPTIONS } from './weeks-four-five-story-options.ts';
import { REMAINING_DAYS } from './remaining-content.ts';
import { FAMILY_PROMPTS } from './family-prompts.ts';
import { DAY_NOTES } from './day-notes.ts';
import { STORY_STARTS } from './story-starts.ts';
import { WEEK_1, WEEK_2, WEEK_3, SCENARIOS_W1_3 } from './weeks-01-03.ts';
import { WEEK_4, WEEK_5, WEEK_6, SCENARIOS_W4_6 } from './weeks-04-06.ts';
import { WEEK_7, WEEK_8, WEEK_9, SCENARIOS_W7_9 } from './weeks-07-09.ts';
import { WEEK_10, WEEK_11, WEEK_12, SCENARIOS_W10_12 } from './weeks-10-12.ts';

const RAW_PROGRAM: WeekPlan[] = [
  WEEK_1,
  WEEK_2,
  WEEK_3,
  WEEK_4,
  WEEK_5,
  WEEK_6,
  WEEK_7,
  WEEK_8,
  WEEK_9,
  WEEK_10,
  WEEK_11,
  WEEK_12,
];


/**
 * Темы 4–12 получают свои родительские тексты из `family-prompts.ts`.
 *
 * Раньше здесь стоял один общий набор на девять тем: он убрал из старых текстов
 * обещания результата, но вместе с ними убрал и смысл — с четвёртой недели
 * взрослый читал одно и то же, а блок «практика в парах» в плане встречи
 * повторялся дословно. Теперь у каждой темы свои три идеи и свой вопрос.
 *
 * Условия те же, что были у общего набора: всё добровольно, оценок нет,
 * результата не обещаем. `parentGoal` остаётся общим намеренно: это не текст
 * для чтения, а метка для внутренних отчётов.
 */
const GENERIC_PARENT_GOAL = 'Познакомиться с разными вариантами без оценки и обязательного обсуждения.';

export const PROGRAM: WeekPlan[] = RAW_PROGRAM.map(week => {
  if (week.week < 4) return week;
  const prompts = FAMILY_PROMPTS[week.week];
  const days = week.days.map(day => ({
    ...day,
    // Тема дня берётся из авторской заготовки: у дней 16–60 она своя, а не
    // скопированная из названия недели.
    theme: REMAINING_DAYS[day.scenarioId]?.title ?? day.theme,
    parentGoal: GENERIC_PARENT_GOAL,
  }));
  // Если для темы текст не написан, неделя остаётся как есть: подставлять
  // чужой шаблон молча — то, от чего мы уходили. Отсутствие ловит тест.
  return prompts ? { ...week, ...prompts, days } : { ...week, days };
});

/** Все 60 сценариев программы (по 5 на неделю). */
const RAW_SCENARIOS: Scenario[] = [
  ...SCENARIOS_W1_3,
  ...SCENARIOS_W4_6,
  ...SCENARIOS_W7_9,
  ...SCENARIOS_W10_12,
];


const bands = ['5-7', '8-10', '11-13'] as const;
/**
 * Сценарии дней: текст, варианты и заметки.
 *
 * Три источника, и каждый отвечает за своё:
 *  - `REMAINING_DAYS` — ситуация, название и варианты для дней 16–60;
 *  - `DAY_NOTES` — вопрос ребёнку и родительские заметки к каждому такому дню;
 *  - `STORY_STARTS` — начало сцены для дней, у которых его не было.
 *
 * Вопрос ребёнку теперь свой у каждого дня. Раньше у 45 дней текст заканчивался
 * одной и той же фразой «Что можно выбрать?» — к четвёртой неделе её перестают
 * читать, а ведущий перестаёт произносить.
 */
export const PROGRAM_SCENARIOS: Scenario[] = RAW_SCENARIOS.map(original => {
  const day = REMAINING_DAYS[original.id];
  const notes = DAY_NOTES[original.id];
  const starts = STORY_STARTS[original.id];

  if (!day) {
    /*
     * Недели 1–3: текст уже написан под каждый возраст, здесь добавляется
     * только начало сцены для этюда. Нет начала — сцена остаётся без него, и
     * план встречи не выдумывает реплику.
     */
    if (!starts) return original;
    const variants = Object.fromEntries(bands.map((band, i) => [
      band,
      { ...original.variants[band], start: original.variants[band].start ?? starts[i] },
    ])) as Scenario['variants'];
    return { ...original, variants };
  }

  const adapted = WEEKS_FOUR_FIVE_STORY_OPTIONS[original.id] ?? WEEKS_SIX_EIGHT_STORY_OPTIONS[original.id] ?? WEEKS_NINE_TWELVE_STORY_OPTIONS[original.id];
  const variants = Object.fromEntries(bands.map((band, i) => [band, {
    // Название под возраст: у 5-летнего не должно быть заголовка сцены,
    // написанного для 12-летнего. Если своего названия нет — общее.
    title: day.titles?.[i] ?? day.title,
    text: `${day.situation[i]} ${notes?.ask ?? ''}`.trim(),
    // Первое действие сцены для этюда: без него педагог говорит «покажите
    // ссору», и группа стоит. Возраст тот же, что и у текста ситуации.
    // Приоритет у `STORY_STARTS`: там лежат исправленные начала для дней, где
    // первая реплика в старой заготовке не совпадала с ситуацией (например,
    // герой находил флешку там, где в тексте блокнот).
    ...(starts?.[i] ?? day.begin?.[i] ? { start: starts?.[i] ?? day.begin?.[i] } : {}),
    // Порядок вариантов не означает оценки: метки сняты из всего контента.
    options: (adapted?.[band] ?? day.actions).map((text) => ({ text, note: 'Это один из возможных вариантов. Выбор можно обсудить, а можно не обсуждать.' })),
  }])) as Scenario['variants'];

  // Заметки дня: у каждого из 45 дней свой текст. Если заметки нет, остаются
  // прежние поля сценария — тест проверяет, что такие дни не появляются.
  return { ...original, variants,
    ...(notes ? {
      practiceWhy: notes.practiceWhy,
      home: notes.home,
      report: notes.report,
      growth: notes.growth,
      question: notes.question,
    } : {}),
  };
});

export const SCENARIO_BY_ID: Record<string, Scenario> = Object.fromEntries(
  PROGRAM_SCENARIOS.map((s) => [s.id, s]),
);

/** Плоский список дней программы: 12 недель × 5 дней = 60. */
export const PROGRAM_DAYS: { week: WeekPlan; day: DayPlan; index: number }[] = PROGRAM.flatMap(
  (week) => week.days.map((day) => ({ week, day, index: -1 })),
);

PROGRAM_DAYS.forEach((d, i) => {
  d.index = i;
});

export const TOTAL_DAYS = PROGRAM_DAYS.length;

export function programDay(index: number) {
  const safe = Math.max(0, Math.min(index, TOTAL_DAYS - 1));
  return PROGRAM_DAYS[safe];
}

export function weekByNumber(week: number): WeekPlan {
  return PROGRAM.find((w) => w.week === week) ?? PROGRAM[0];
}

export function scenarioOfProgramDay(index: number): Scenario {
  const { day } = programDay(index);
  return SCENARIO_BY_ID[day.scenarioId];
}
