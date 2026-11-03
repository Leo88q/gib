import type { Scenario } from '../softskills';
import type { DayPlan, WeekPlan } from './types';
import { WEEKS_NINE_TWELVE_STORY_OPTIONS } from './weeks-nine-twelve-story-options.ts';
import { WEEKS_SIX_EIGHT_STORY_OPTIONS } from './weeks-six-eight-story-options.ts';
import { WEEKS_FOUR_FIVE_STORY_OPTIONS } from './weeks-four-five-story-options.ts';
import { REMAINING_DAYS } from './remaining-content.ts';
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


/** Weeks 4–12 use the revised, voluntary family prompts rather than old outcome claims. */
export const PROGRAM: WeekPlan[] = RAW_PROGRAM.map(week => week.week < 4 ? week : ({
  ...week,
  subtitle: 'Обсуждаем вымышленные ситуации и разные варианты',
  parentNote: 'Истории предлагают варианты для обсуждения, а не проверяют характер или навыки ребёнка. Участие и разговор дома добровольны.',
  homeIdeas: ['Если ребёнок хочет, обсудите любую вымышленную ситуацию.', 'Можно вместе придумать другой вариант или пропустить разговор.', 'При необходимости помогите ребёнку обратиться к знакомому взрослому.'],
  weekQuestion: 'Хотите ли вы обсудить какую-нибудь вымышленную историю?',
  days: week.days.map(day => ({ ...day, theme: REMAINING_DAYS[day.scenarioId].title, parentGoal: 'Познакомиться с разными вариантами без оценки и обязательного обсуждения.' })),
}));

/** Все 60 сценариев программы (по 5 на неделю). */
const RAW_SCENARIOS: Scenario[] = [
  ...SCENARIOS_W1_3,
  ...SCENARIOS_W4_6,
  ...SCENARIOS_W7_9,
  ...SCENARIOS_W10_12,
];


const bands = ['5-7', '8-10', '11-13'] as const;
/** Keep the old quality field for persisted session compatibility, never as feedback. */
export const PROGRAM_SCENARIOS: Scenario[] = RAW_SCENARIOS.map(original => {
  const day = REMAINING_DAYS[original.id];
  if (!day) return original;
  const adapted = WEEKS_FOUR_FIVE_STORY_OPTIONS[original.id] ?? WEEKS_SIX_EIGHT_STORY_OPTIONS[original.id] ?? WEEKS_NINE_TWELVE_STORY_OPTIONS[original.id];
  const variants = Object.fromEntries(bands.map((band, i) => [band, {
    title: day.title,
    text: `${day.situation[i]} Что можно выбрать?`,
    options: (adapted?.[band] ?? day.actions).map((text, index) => ({ text, ...(!adapted ? { quality: (['good', 'partial', 'bad'] as const)[index] } : {}), note: 'Это один из возможных вариантов. Выбор можно обсудить, а можно не обсуждать.' })),
  }])) as Scenario['variants'];
  return { ...original, variants,
    practiceWhy: 'Игровое задание и история — разные части занятия; история не измеряет навык.',
    home: 'Если ребёнок хочет, обсудите вымышленную ситуацию или придумайте другой вариант.',
    report: 'Ребёнок посмотрел историю и выбрал вариант; это не оценка поведения.',
    growth: 'По одному выбору нельзя делать выводы о ребёнке.',
    question: 'Хотите обсудить вымышленную историю или выбрать другое занятие?',
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
