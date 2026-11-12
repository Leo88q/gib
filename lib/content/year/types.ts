import type { DayPlan, WeekPlan } from '../program/types';
import type { SkillId } from '../../types';

/**
 * Годовая сетка: 36 занятий вместо 60 дней как единицы программы.
 *
 * Зачем отдельный модуль, а не переделка `PROGRAM`. `PROGRAM` — это 12 тем по 5
 * дней симулятора, и на нём завязаны прогресс, отчёты, сценарии, продолжения и
 * десяток тестов. Если поменять его форму, сломается всё сразу, а пользы на
 * первом шаге ноль: содержание не меняется, меняется только вид сверху.
 *
 * Поэтому год надстраивается над днями, а не заменяет их:
 *
 *   тема (WeekPlan)  →  занятия (Lesson)  →  дни симулятора (DayPlan)
 *
 * Дни остаются ровно теми же и в том же порядке. Занятие — новая единица
 * планирования и новый способ показать родителю, где ребёнок.
 *
 * Решение принято 07.11.2026: единица программы — учебный год, одно занятие в
 * неделю, симулятор — домашняя практика между занятиями.
 */

export type Lesson = {
  /** 1..36 — сквозная нумерация занятий за год. */
  number: number;
  /** Тема (бывшая неделя программы), 1..12. */
  unit: number;
  /** Какое по счёту занятие внутри темы, 1..k. */
  inUnit: number;
  /** Сколько занятий в этой теме всего. */
  ofUnit: number;
  /** Название для расписания: из темы и номера занятия. */
  title: string;
  /** Главные навыки занятия — объединение навыков его дней. */
  skills: SkillId[];
  /** Индексы дней симулятора (в PROGRAM_DAYS), которые идут после занятия. */
  dayIndexes: number[];
  /**
   * Завершающее занятие темы. По программе это мини-показ: ребёнок показывает,
   * что получилось. За год таких двенадцать вместо одного выпускного.
   */
  isShowcase: boolean;
};

export type YearPlan = {
  lessons: Lesson[];
  /** Сколько всего занятий в году. */
  total: number;
  /** Сколько дней симулятора суммарно. */
  totalDays: number;
};

/**
 * Сколько занятий на каждую тему. Посчитано от числа навыков в теме, а не от
 * «важности»: минимум два занятия (занятие и мини-показ), остальные двенадцать
 * распределены пропорционально. Обоснование — `docs/program-year-design.md`.
 *
 * Индекс массива + 1 = номер темы.
 */
export const LESSONS_PER_UNIT: readonly number[] = [4, 3, 3, 3, 3, 3, 3, 3, 3, 2, 3, 3];

/**
 * Как разложить дни симулятора по занятиям внутри темы.
 *
 * Домашняя практика идёт ПОСЛЕ занятия, поэтому первое занятие темы получает
 * больше дней: ребёнок уходит с занятия и практикуется до следующего. Последнее
 * занятие — мини-показ, после него день только один: показывать и разбирать.
 */
function splitDays(dayCount: number, lessonCount: number): number[] {
  if (lessonCount <= 0) return [];
  if (lessonCount === 1) return [dayCount];
  const showcase = 1;
  const rest = dayCount - showcase;
  const weights = Array.from({ length: lessonCount - 1 }, (_, i) => (i === 0 ? 2 : 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const base = weights.map((w) => Math.floor((rest * w) / weightSum));
  let leftover = rest - base.reduce((a, b) => a + b, 0);
  for (let i = 0; leftover > 0; i = (i + 1) % base.length) {
    base[i] += 1;
    leftover -= 1;
  }
  return [...base, showcase];
}

function buildYear(weeks: WeekPlan[], days: readonly { week: WeekPlan; day: DayPlan; index: number }[]): YearPlan {
  const lessons: Lesson[] = [];
  let number = 0;

  for (const week of weeks) {
    const unit = week.week;
    const lessonCount = LESSONS_PER_UNIT[unit - 1];
    if (!lessonCount) throw new Error(`тема ${unit} без числа занятий: сетка неполная`);

    const weekDays = days.filter((d) => d.week.week === unit).sort((a, b) => a.day.day - b.day.day);
    const perLesson = splitDays(weekDays.length, lessonCount);

    let cursor = 0;
    for (let i = 0; i < lessonCount; i += 1) {
      const chunk = weekDays.slice(cursor, cursor + perLesson[i]);
      cursor += perLesson[i];
      const skills = [...new Set(chunk.flatMap((d) => [d.day.focus]))];
      number += 1;
      lessons.push({
        number,
        unit,
        inUnit: i + 1,
        ofUnit: lessonCount,
        title: i === lessonCount - 1 ? `${week.title}: показываем` : week.title,
        skills,
        dayIndexes: chunk.map((d) => d.index),
        isShowcase: i === lessonCount - 1,
      });
    }
  }

  return {
    lessons,
    total: lessons.length,
    totalDays: days.length,
  };
}

export function buildYearPlan(
  weeks: WeekPlan[],
  days: readonly { week: WeekPlan; day: DayPlan; index: number }[],
): YearPlan {
  return buildYear(weeks, days);
}

/** Занятие, к которому относится день симулятора. */
export function lessonOfDay(year: YearPlan, dayIndex: number): Lesson | undefined {
  return year.lessons.find((lesson) => lesson.dayIndexes.includes(dayIndex));
}

/** Занятия одной темы по порядку. */
export function lessonsOfUnit(year: YearPlan, unit: number): Lesson[] {
  return year.lessons.filter((lesson) => lesson.unit === unit);
}

/**
 * Где ребёнок в году: сколько занятий из 36 пройдено.
 *
 * Считается по числу завершённых дней: занятие считается пройденным, когда
 * пройдены все его дни. Незавершённое занятие не засчитывается — иначе ребёнок,
 * открывший первый день темы, «прошёл» бы и занятие, и мини-показ.
 */
export function yearProgress(year: YearPlan, completedDayIndexes: readonly number[]): {
  lessonsDone: number;
  lessonsTotal: number;
  daysDone: number;
  daysTotal: number;
  currentLesson: Lesson | undefined;
} {
  const done = new Set(completedDayIndexes);
  const lessonsDone = year.lessons.filter(
    (lesson) => lesson.dayIndexes.length > 0 && lesson.dayIndexes.every((index) => done.has(index)),
  ).length;
  const currentLesson = year.lessons.find(
    (lesson) => !lesson.dayIndexes.every((index) => done.has(index)),
  );

  return {
    lessonsDone,
    lessonsTotal: year.total,
    daysDone: year.lessons.reduce(
      (sum, lesson) => sum + lesson.dayIndexes.filter((index) => done.has(index)).length,
      0,
    ),
    daysTotal: year.totalDays,
    currentLesson,
  };
}
