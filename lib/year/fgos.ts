/**
 * Разметка занятий под ФГОС НОО: язык, на котором школа нас слышит.
 *
 * Зачем это нужно. Родителю достаточно «детям полезно». Учителю и завучу нет: им
 * нужно, чтобы программа легла в рабочую программу и в личностные результаты,
 * иначе занятие — «кружок, которого нет в плане». Без этого столбца школа не
 * покупает, даже если методика хорошая.
 *
 * Откуда взят подход. Из того, как это сделано в Drama Teacher Academy
 * (Theatrefolk): каждое упражнение размечено под компонент SEL И под конкретный
 * стандарт штата, после каждого шага — ссылка. Мы делаем то же, но с ФГОС НОО.
 *
 * Чего здесь нет и почему. Точных кодов вида «2.1.1» здесь нет намеренно:
 * кодировка ФГОС меняется между редакциями, а цитировать документ по памяти —
 * значит рисковать ошибкой в официальном названии. Поэтому указаны **группы
 * результатов** (личностные / метапредметные / предметные) и их направления —
 * так, как они названы в стандарте. Точные коды проставляет методист школы по
 * своей редакции ФГОС: это одна таблица на 36 строк, а не переписывание
 * продукта.
 *
 * Ещё одно ограничение. ФГОС НОО начинается с начальной школы (1–4 класс), а
 * программа идёт с 5 лет. Разметка даётся для линейки 8–10 и 11–13; для 5–7
 * указывается «дошкольное образование» и результат формулируется словами, а не
 * ссылкой на стандарт. Это честнее, чем натягивать ФГОС на пятилетнего.
 */

import type { CompetencyId } from '../types.ts';
import type { Lesson, YearPlan } from '../content/year/types.ts';
import { PROGRAM_DAYS, SCENARIO_BY_ID, weekByNumber } from '../content/program/index.ts';

/** Группа результатов ФГОС. */
export type FgosGroup = 'personal' | 'meta' | 'subject' | 'preschool';

/**
 * Направление внутри группы.
 *
 * Формулировки повторяют официальные названия, но без кодов: код зависит от
 * редакции, а направление — нет.
 */
export type FgosArea =
  | 'self_development'
  | 'meaning_making'
  | 'moral_orientation'
  | 'communication'
  | 'self_regulation'
  | 'cooperation'
  | 'reflection'
  | 'creative_activity'
  | 'preschool_social';

export const FGOS_LABEL: Readonly<Record<FgosGroup, string>> = {
  personal: 'Личностные результаты',
  meta: 'Метапредметные результаты',
  subject: 'Предметные результаты',
  preschool: 'Дошкольное образование (ФГОС ДО)',
};

export const FGOS_AREA_LABEL: Readonly<Record<FgosArea, string>> = {
  self_development: 'Самоопределение и саморазвитие',
  meaning_making: 'Смыслообразование: зачем мне это',
  moral_orientation: 'Нравственно-этическая ориентация',
  communication: 'Коммуникация: умение слушать и договариваться',
  self_regulation: 'Саморегуляция: управлять своим поведением',
  cooperation: 'Совместная деятельность',
  reflection: 'Рефлексия: оценивать свои действия',
  creative_activity: 'Творческая деятельность',
  preschool_social: 'Социально-коммуникативное развитие',
};

/**
 * Соответствие «компетенция продукта → направление ФГОС».
 *
 * Почему соответствие не один-к-одному. Компетенция продукта — про навык, а
 * направление ФГОС — про результат в терминах школы. Одна компетенция может
 * ложиться в два направления, и тогда в плане занятия ставятся оба. Натягивать
 * по одному было бы красивее, но неверно.
 */
export const FGOS_BY_COMPETENCY: Readonly<Record<CompetencyId, readonly FgosGroup[]>> = {
  self_awareness: ['personal', 'meta'],
  self_regulation: ['meta', 'personal'],
  empathy: ['personal', 'meta'],
  relationships: ['meta', 'personal'],
  decision_making: ['personal', 'meta'],
  creative_thinking: ['meta', 'subject'],
  growth_mindset: ['personal'],
};

/**
 * Направление внутри группы для каждой компетенции: первое — основное,
 * остальные — сопутствующие.
 */
export const AREA_BY_COMPETENCY: Readonly<Record<CompetencyId, readonly FgosArea[]>> = {
  self_awareness: ['self_development', 'reflection'],
  self_regulation: ['self_regulation', 'reflection'],
  empathy: ['moral_orientation', 'communication'],
  relationships: ['communication', 'cooperation'],
  decision_making: ['meaning_making', 'self_development'],
  creative_thinking: ['creative_activity'],
  growth_mindset: ['meaning_making', 'reflection'],
};

/** Что проверяет школа: одна строка на занятие, которую можно вставить в программу. */
export type LessonAlignment = {
  lesson: number;
  unit: number;
  unitTitle: string;
  /** Компетенции занятия — из навыков его дней. */
  competencies: CompetencyId[];
  /** Группы результатов, которые закрывает занятие. */
  groups: FgosGroup[];
  /** Направления внутри групп. */
  areas: FgosArea[];
  /** Формулировка для рабочей программы: одна фраза. */
  wording: string;
};

/**
 * Компетенции занятия — из сценариев его дней, а не из `Lesson.skills`.
 *
 * Это исправление ошибки, которую поймал первый прогон. В `Lesson.skills` лежат
 * **когнитивные** навыки (`inhibition`, `attention`) — они относятся к тренировке,
 * а не к социальному содержанию. Первая версия разметки брала их и получала 36
 * занятий без компетенций: `SKILL_BY_ID` когнитивных навыков не знает.
 *
 * Социальная компетенция живёт в двух местах, и оба нужны:
 *  - компетенция темы (`weekByNumber(unit).competency`) — рамка всего занятия;
 *  - компетенции сценариев дней — что ребёнок реально разбирал дома.
 *
 * Тема даёт рамку, сценарии — содержание. Если брать только тему, разметка
 * потеряет сцены, которые в неё не попадают (так и было в первой теме: тема
 * про самопознание, а первый день — про эмпатию).
 */
export function competenciesOfLesson(lesson: Lesson): CompetencyId[] {
  const found = new Set<CompetencyId>();
  const weekCompetency = weekByNumber(lesson.unit).competency;
  if (weekCompetency) found.add(weekCompetency);

  for (const index of lesson.dayIndexes) {
    const entry = PROGRAM_DAYS[index];
    if (!entry) continue;
    const scenario = SCENARIO_BY_ID[entry.day.scenarioId];
    if (scenario?.competency) found.add(scenario.competency);
  }

  // Порядок важен: первая компетенция становится главной в формулировке.
  // Рамка темы идёт первой, содержание — после.
  return [weekCompetency, ...Array.from(found).filter((item) => item !== weekCompetency)].filter(
    (value): value is CompetencyId => Boolean(value),
  );
}

/**
 * Разметка одного занятия.
 */
export function alignLesson(lesson: Lesson, _competencyOfSkill?: (skillId: string) => CompetencyId | undefined): LessonAlignment {
  const competencies = competenciesOfLesson(lesson);

  const groups = new Set<FgosGroup>();
  const areas = new Set<FgosArea>();
  for (const competency of competencies) {
    for (const group of FGOS_BY_COMPETENCY[competency] ?? []) groups.add(group);
    for (const area of AREA_BY_COMPETENCY[competency] ?? []) areas.add(area);
  }

  const orderedGroups = (['personal', 'meta', 'subject'] as const).filter((group) => groups.has(group));

  return {
    lesson: lesson.number,
    unit: lesson.unit,
    unitTitle: lesson.title,
    competencies,
    groups: orderedGroups,
    areas: Array.from(areas),
    wording: wordingFor(lesson, competencies, orderedGroups),
  };
}

/**
 * Формулировка для рабочей программы.
 *
 * Пишется так, как пишут в программе: не «дети развивают эмпатию», а «на
 * занятии формируется умение замечать состояние другого и предлагать помощь».
 * Глагол «формируется» — школьный, но не оценочный: он не утверждает, что
 * результат достигнут.
 */
function wordingFor(lesson: Lesson, competencies: CompetencyId[], groups: readonly FgosGroup[]): string {
  if (competencies.length === 0) {
    return `Занятие ${lesson.number}: ${lesson.title}. Результат уточняется методистом.`;
  }

  const first = competencies[0];
  const outcomes: Record<CompetencyId, string> = {
    self_awareness: 'умение называть своё состояние и связывать его с причиной',
    self_regulation: 'умение возвращаться к задаче после сбоя',
    empathy: 'умение замечать состояние другого и реагировать действием',
    relationships: 'умение предлагать, договариваться и принимать отказ',
    decision_making: 'умение называть варианты и их последствия',
    creative_thinking: 'умение создавать и дорабатывать своё',
    growth_mindset: 'умение относиться к ошибке как к части работы',
  };

  /**
   * Уточнение из содержания занятия.
   *
   * Без него на 36 занятий приходилось 14 формулировок: семь занятий подряд
   * описывались словами «умение возвращаться к задаче после сбоя». Формально
   * верно — саморегуляция одна, — но в рабочей программе это выглядит как
   * скопированная строка, и завуч спрашивает, чем занятия отличаются.
   *
   * Отвечаем его же языком: «на материале ситуаций „Время подумать“,
   * „Передышка по выбору“». Названия сцен — из контента, а не придуманные:
   * если сценарий переименуют, строка поедет за ним.
   */
  const materials = lessonMaterials(lesson);
  const extra = competencies.slice(1).map((competency) => outcomes[competency]).join('; ');
  const base = materials
    ? `На занятии формируется ${outcomes[first]} — на материале ситуаций ${materials}`
    : `На занятии формируется ${outcomes[first]}`;
  return extra ? `${base}; сопутствующее — ${extra}.` : `${base}.`;
}

/**
 * Названия ситуаций занятия для формулировки.
 *
 * Берутся названия сценариев дней занятия: «Приглашение Миры», «Шум на
 * репетиции». Это то, что видит ребёнок и что узнаёт учитель, если откроет
 * программу.
 *
 * Максимум две: в строке рабочей программы больше — уже перечисление, и его
 * не читают. Порядок — как в занятии, чтобы номер занятия и текст сходились.
 */
function lessonMaterials(lesson: Lesson): string {
  const titles: string[] = [];
  for (const dayIndex of lesson.dayIndexes) {
    const week = Math.floor(dayIndex / 5) + 1;
    const day = (dayIndex % 5) + 1;
    const scenario = SCENARIO_BY_ID[`w${week}d${day}`];
    const title = scenario?.variants?.['8-10']?.title;
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length === 2) break;
  }
  return titles.map((title) => `«${title}»`).join(', ');
}

/**
 * Разметка всего года: 36 строк, которые можно отдать школе.
 *
 * Собирается из тех же занятий, что и календарь, — не отдельная таблица.
 */
export function alignYear(year: YearPlan): LessonAlignment[] {
  return year.lessons.map((lesson) => alignLesson(lesson));
}

/**
 * Сводка покрытия: сколько занятий закрывает каждое направление ФГОС.
 *
 * Нужна завучу, который спросит «а коммуникация у вас где?» — и получит ответ
 * номерами занятий, а не общими словами.
 */
export function fgosCoverage(alignments: readonly LessonAlignment[]): {
  byGroup: Record<FgosGroup, number>;
  byArea: Record<FgosArea, number>;
  lessonsByArea: Record<string, number[]>;
} {
  const byGroup: Record<FgosGroup, number> = { personal: 0, meta: 0, subject: 0, preschool: 0 };
  const byArea: Record<FgosArea, number> = {
    self_development: 0,
    meaning_making: 0,
    moral_orientation: 0,
    communication: 0,
    self_regulation: 0,
    cooperation: 0,
    reflection: 0,
    creative_activity: 0,
    preschool_social: 0,
  };
  const lessonsByArea: Record<string, number[]> = {};

  for (const alignment of alignments) {
    for (const group of alignment.groups) byGroup[group] += 1;
    for (const area of alignment.areas) {
      byArea[area] += 1;
      lessonsByArea[area] = [...(lessonsByArea[area] ?? []), alignment.lesson];
    }
  }

  return { byGroup, byArea, lessonsByArea };
}
