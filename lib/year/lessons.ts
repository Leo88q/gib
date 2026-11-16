/**
 * Занятия года: 36 встреч раз в неделю и отметки о посещении.
 *
 * Зачем это отдельно от `lib/content/year`. Там — сетка: что за чем идёт.
 * Здесь — календарь: когда занятие и кто на нём был. Сетка не зависит от дат,
 * календарь целиком из дат.
 *
 * Зачем это вообще нужно.
 *  1. Замер. Дозировка — это не «прошёл программу», а сколько занятий ребёнок
 *     посетил. Без отметок нельзя отделить эффект программы от эффекта
 *     посещаемости, и нельзя посчитать решение 7 (отказ от выхода) на тех, кто
 *     редко ходит.
 *  2. Расписание. Родитель видит, когда следующее занятие, а не «день 34 из 60».
 *  3. Выбывание. За год уходит 25–40% детей, и важно не сколько, а кто. Отметка
 *     посещения — единственный способ увидеть это до конца года.
 *
 * Чего здесь нет и почему.
 *  - Оценок. Отметка занятия — «был / не был», а не «как отвечал».
 *  - Причин отсутствия. Причина — чувствительное поле, и его сбор требует
 *    отдельного согласия. Пока не решено, не собираем.
 *  - Домашних заданий. Симулятор между занятиями уже есть; связывать его с
 *    занятием будет отдельным шагом.
 */

import type { Lesson, YearPlan } from '../content/year/types.ts';

/** Одно занятие в календаре: номер занятия, дата (`YYYY-MM-DD`) и отметка. */
export type ScheduledLesson = {
  lesson: number;
  /** Календарная дата занятия, `YYYY-MM-DD`. */
  date: string;
  /** Был ли ребёнок. `undefined` — занятие ещё не отмечено. */
  attended?: boolean;
  /**
   * Как ребёнок вышел показывать — только для занятий-показов.
   *
   * Центральный результат актёрской методики: ребёнок преодолевает страх
   * выхода на публику. Шкала 0–2, и она измеряет не качество выступления, а
   * факт выхода:
   *
   *   0 — отказался после двух приглашений;
   *   1 — вышел после приглашения;
   *   2 — вышел сам, не дожидаясь приглашения.
   *
   * Почему не 0–3 и почему не «как выступил»: качество на этом этапе
   * не оценивается вовсе. Оценка выступления превращает показ в экзамен, и
   * тогда отказ становится рациональным решением, а методика теряет смысл.
   * Три отметки — минимум, при котором видно движение от отказа к
   * самостоятельности; одна («выступил / не выступил») этого не различает.
   */
  showcase?: ShowcaseLevel;
};

/**
 * Якоря шкалы показа. Объявлены здесь, потому что это единственное место, где
 * шкала живёт в продукте; бланк и протокол ссылаются на этот список, чтобы
 * через полгода не разошлись формулировки.
 */
export const SHOWCASE_ANCHORS: Readonly<Record<ShowcaseLevel, string>> = {
  0: 'Отказался после двух приглашений',
  1: 'Вышел после приглашения',
  2: 'Вышел сам, не дожидаясь приглашения',
};

export type ShowcaseLevel = 0 | 1 | 2;

/**
 * Расписание года: 36 дат, начиная с даты старта, раз в неделю.
 *
 * Даты считаются от старта, а не от 1 сентября: группы начинают в разное время,
 * и календарь должен следовать за группой, а не за учебным годом.
 */
export function buildSchedule(year: YearPlan, startDate: string): ScheduledLesson[] {
  const start = parseDate(startDate);
  if (!start) throw new Error(`дата старта не разобрана: ${startDate}`);

  return year.lessons.map((lesson, index) => ({
    lesson: lesson.number,
    date: formatDate(addDays(start, index * 7)),
  }));
}

/**
 * Отметка посещения. Возвращает новое расписание, исходное не меняется:
 * состояние живёт в хранилище, а не в модуле.
 */
export function markAttendance(
  schedule: readonly ScheduledLesson[],
  lessonNumber: number,
  attended: boolean,
): ScheduledLesson[] {
  const found = schedule.some((entry) => entry.lesson === lessonNumber);
  if (!found) throw new Error(`занятия ${lessonNumber} нет в расписании`);
  return schedule.map((entry) =>
    entry.lesson === lessonNumber ? { ...entry, attended } : entry,
  );
}

/** Сводка посещаемости: то, что идёт в отчёт и в анализ дозировки. */
export type AttendanceSummary = {
  /** Сколько занятий уже прошло по календарю на указанную дату. */
  held: number;
  /** Из них отмечено «был». */
  attended: number;
  /** Из них отмечено «не был». */
  missed: number;
  /** Прошло, но не отмечено. */
  unmarked: number;
  /**
   * Доля посещённых от прошедших и отмеченных. `undefined`, если отмеченных нет:
   * ноль вместо «неизвестно» — это ложь, которая выглядит как данные.
   */
  share?: number;
};

export function attendanceSummary(
  schedule: readonly ScheduledLesson[],
  today: string,
): AttendanceSummary {
  const heldEntries = schedule.filter((entry) => entry.date <= today);
  const attended = heldEntries.filter((entry) => entry.attended === true).length;
  const missed = heldEntries.filter((entry) => entry.attended === false).length;
  const unmarked = heldEntries.length - attended - missed;

  return {
    held: heldEntries.length,
    attended,
    missed,
    unmarked,
    share: attended + missed > 0 ? attended / (attended + missed) : undefined,
  };
}

/** Следующее занятие после указанной даты — то, что показываем родителю. */
export function nextLesson(
  schedule: readonly ScheduledLesson[],
  today: string,
): ScheduledLesson | undefined {
  return schedule.find((entry) => entry.date >= today);
}

/** Занятия, к которым привязаны дни симулятора: удобно для отчёта. */
export function lessonAt(year: YearPlan, lessonNumber: number): Lesson | undefined {
  return year.lessons.find((lesson) => lesson.number === lessonNumber);
}

/* ------------------------------ даты ------------------------------ */

/**
 * Даты считаем строками `YYYY-MM-DD` в UTC, без объектов Date в хранилище.
 * Причина: `Date` зависит от часового пояса, и «занятие 5 сентября» в одном
 * поясе становится «4 сентября» в другом. Для расписания занятий это неверно.
 */
function parseDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  asUtc.setUTCDate(asUtc.getUTCDate() + days);
  return {
    year: asUtc.getUTCFullYear(),
    month: asUtc.getUTCMonth() + 1,
    day: asUtc.getUTCDate(),
  };
}

/**
 * Какому занятию принадлежит день симулятора.
 *
 * `dayIndexes` занятия — это дни, которые идут ПОСЛЕ него. Значит день N
 * относится к последнему занятию, все дни которого ≤ N.
 */
export function lessonOfDayIndex(year: YearPlan, dayIndex: number): Lesson | undefined {
  let found: Lesson | undefined;
  for (const lesson of year.lessons) {
    if (lesson.dayIndexes.length === 0) continue;
    // День относится к занятию, если он в его днях. Проверка через `includes`,
    // а не через `max <= dayIndex`: первое занятие начинается с дня 0, и
    // условие «максимум не больше нуля» для него не выполняется — день 0
    // попадал в никуда. Тест поймал это на первом же дне.
    if (lesson.dayIndexes.includes(dayIndex)) return lesson;
    if (Math.max(...lesson.dayIndexes) <= dayIndex) found = lesson;
  }
  return found;
}

/**
 * «Следующая встреча» и «к чему ребёнок готов» — два разных вопроса.
 *
 * Раньше здесь было одно поле, и это была ошибка, которую поймал тест.
 * Календарная встреча назначается школой: она не сдвигается от того, что
 * ребёнок прошёл дни вперёд или не прошёл назад. А готовность ребёнка — это
 * его дни в приложении, и она может и обгонять календарь, и отставать от него.
 *
 * Если смешать их в одном числе, получается враньё в обе стороны:
 *  - ребёнок ушёл вперёд — семья видит «11» и думает, что прогресс потерялся;
 *  - ребёнок отстал — семья видит «31» и не понимает, почему на встрече
 *    спрашивают про то, чего он не проходил.
 *
 * Поэтому возвращаются оба числа, а `gap` говорит, расходятся ли они.
 */
export type LessonToShow = {
  /** Ближайшая встреча по расписанию: дата и номер, как их знает школа. */
  lesson: number;
  date: string;
  /** Первое занятие, у которого не пройдены все дни симулятора. */
  readyFor: number;
  /**
   * `ahead` — ребёнок прошёл дни дальше ближайшей встречи;
   * `behind` — не прошёл дни предыдущих занятий;
   * `calendar` — идёт ровно в календаре.
   */
  gap: 'calendar' | 'ahead' | 'behind';
};

/**
 * Ближайшая встреча по расписанию, если она вообще есть.
 *
 * Будущее занятие всегда «дальше»: расписание не зависит от прогресса.
 * Возвращается `undefined`, только когда год закончился.
 */
export function lessonToShow(params: {
  year: YearPlan;
  schedule: readonly ScheduledLesson[];
  completedDayIndexes: readonly number[];
  today: string;
}): LessonToShow | undefined {
  const { year, schedule, completedDayIndexes, today } = params;

  const byCalendar = nextLesson(schedule, today);
  if (!byCalendar) return undefined;

  const done = new Set(completedDayIndexes);
  const firstUnfinished = year.lessons.find((lesson) => !lesson.dayIndexes.every((index) => done.has(index)));

  // Год пройден: встреча есть, а готовиться не к чему. Это не «вперёд» и не
  // «отстаёт», а конец программы.
  if (!firstUnfinished) {
    return { lesson: byCalendar.lesson, date: byCalendar.date, readyFor: year.lessons[year.lessons.length - 1].number, gap: 'calendar' };
  }

  const gap = firstUnfinished.number > byCalendar.lesson ? 'ahead' : firstUnfinished.number < byCalendar.lesson ? 'behind' : 'calendar';

  return { lesson: byCalendar.lesson, date: byCalendar.date, readyFor: firstUnfinished.number, gap };
}

/**
 * Отметка показа: 0, 1 или 2 по шкале выхода.
 *
 * Отдельная функция, а не параметр `markAttendance`: посещение и выход на показ
 * — разные события, и смешивать их в одной подписи значит однажды передать
 * одно вместо другого. Здесь же проверка, что занятие вообще показ: отметка
 * показа на обычном занятии — ошибка вызывающего, а не данные.
 */
export function markShowcase(
  schedule: readonly ScheduledLesson[],
  year: YearPlan,
  lessonNumber: number,
  level: ShowcaseLevel,
): ScheduledLesson[] {
  const entry = schedule.find((item) => item.lesson === lessonNumber);
  if (!entry) throw new Error(`занятия ${lessonNumber} нет в расписании`);

  const lesson = year.lessons.find((item) => item.number === lessonNumber);
  if (!lesson?.isShowcase) throw new Error(`занятие ${lessonNumber} не показ`);

  if (level !== 0 && level !== 1 && level !== 2) throw new Error('уровень показа вне шкалы 0–2');

  return schedule.map((item) => (item.lesson === lessonNumber ? { ...item, showcase: level } : item));
}

/**
 * Сводка показов: сколько раз ребёнок выходил, сколько отказался.
 *
 * Отказ считается отдельно и не вычитается из общего: решение методиста
 * (07.11.2026) — отказавшийся ребёнок это отдельный показатель, а не «ноль
 * баллов» в общей сумме. Иначе отказ растворяется в среднем и перестаёт быть
 * видимым, хотя именно он — главный сигнал для педагога.
 */
export function showcaseSummary(
  schedule: readonly ScheduledLesson[],
  year: YearPlan,
): { shows: number; invited: number; refused: number; marked: number } {
  const showcases = schedule.filter((entry) => {
    const lesson = year.lessons.find((item) => item.number === entry.lesson);
    return lesson?.isShowcase === true;
  });

  const marked = showcases.filter((entry) => entry.showcase !== undefined);
  return {
    shows: marked.filter((entry) => entry.showcase === 2 || entry.showcase === 1).length,
    invited: marked.filter((entry) => entry.showcase === 1).length,
    refused: marked.filter((entry) => entry.showcase === 0).length,
    marked: marked.length,
  };
}
