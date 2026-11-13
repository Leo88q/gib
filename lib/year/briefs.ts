/**
 * Быстрые разборы: 36 коротких карточек «упражнение → что тренирует → почему
 * так».
 *
 * Откуда взято. У Theatrefolk к каждому уроку приложен список стандартов и
 * разбор, а не только план. У нас план встречи был, а разбора не было: педагог
 * видел «10 минут: тренировка, навык в действии», но не понимал, зачем именно
 * это упражнение и что в нём главное.
 *
 * Чем это не является:
 *  - не видеокурс (36 записей — отдельная съёмка, см. пункт разбора 6);
 *  - не методичка на 40 страниц. Карточка читается за минуту, потому что её
 *    открывают перед занятием, а не изучают;
 *  - не оценка ребёнка. Здесь нет «получилось / не получилось»: разбор про
 *    упражнение, а не про того, кто его делал.
 *
 * Все тексты собираются из уже существующих полей сценария и когнитивной
 * задачи. Ничего не придумано: если бы я писал разборы «от себя», они бы
 * разошлись с программой на первой же правке.
 */

import { TASK_BY_ID } from '../content/cognitive.ts';
import { SCENARIO_BY_ID, weekByNumber } from '../content/program/index.ts';
import type { Lesson } from '../content/year/types.ts';
import { competenciesOfLesson } from './fgos.ts';
import { COMPETENCY_TITLE } from './valued.ts';

/** Разбор одного занятия. */
export type QuickBrief = {
  /** Номер занятия в году: 1–36. */
  lesson: number;
  /** Тема недели и название занятия. */
  unitTitle: string;
  /** Короткая строка для списка: что это занятие тренирует человеческими словами. */
  about: string;
  /** Что делают дети. Без этого разбор превращается в теорию. */
  whatChildrenDo: string;
  /** Зачем это упражнение: поле practiceWhy из сценария. */
  why: string;
  /** На что смотреть педагогу во время упражнения. */
  watchFor: string;
  /** Главная мысль, которую нельзя потерять по ходу занятия. */
  keep: string;
  /** Вопрос, которым заканчивается разбор, — для себя, не для ребёнка. */
  askYourself: string;
  /** Сколько секунд читать. Считается по тексту, а не назначается. */
  seconds: number;
  /** Истории занятия: то, что отличает один четверг от другого. */
  scenes: string[];
};

/**
 * Что смотреть педагогу.
 *
 * Формулировки построены вокруг наблюдаемого действия: «слышно», «видно»,
 * «успевает». Не «понял ли», «справился ли» — это оценка, и её в разборе быть
 * не должно.
 */
const WATCH_FOR: Record<string, string> = {
  inhibition:
    'Видно по паузе: ребёнок останавливается перед ответом, а не отвечает первым. Пауза короткая — это норма.',
  working_memory:
    'Слышно по повторам: ребёнок возвращается к началу, чтобы восстановить порядок. Так и работает память, а не «забывчивость».',
  attention:
    'Видно по взгляду: ребёнок проверяет свою работу, а не спешит сдать. Ошибка, которую он нашёл сам, — самый полезный момент упражнения.',
  flexibility:
    'Видно по первой смене правила: кто-то продолжает играть по-старому. Это не ошибка, а то, ради чего упражнение.',
  planning:
    'Слышно по порядку: ребёнок называет шаги вслух, прежде чем начать. Порядок может быть неправильным — важно, что он есть.',
  logic: 'Видно по объяснению: ребёнок говорит, почему так, а не только называет ответ.',
};

/** Что делает педагог в упражнении: три типа сценария. */
function whatChildrenDo(taskId: string | undefined, showcase: boolean): string {
  if (showcase) {
    return 'Дети показывают то, что уже пробовали, и выходят на площадку по своей готовности. Выход — приглашение, а не требование.';
  }
  const task = taskId ? TASK_BY_ID[taskId as keyof typeof TASK_BY_ID] : undefined;
  if (!task) {
    return 'Дети разбирают историю: что происходит, что можно выбрать, чем один вариант отличается от другого.';
  }
  return `Сначала коротко обсуждают историю, потом делают упражнение «${task.title}» — навык в действии, а не на словах.`;
}

/** Собирает разбор по занятию. */
export function quickBrief(lesson: Lesson): QuickBrief {
  const first = lesson.dayIndexes[0];
  const scenario = first !== undefined ? SCENARIO_BY_ID[PROGRAM_DAY_ID(first)] : undefined;
  const units = competenciesOfLesson(lesson);
  const unitTitle = weekByNumber(lesson.unit)?.title ?? 'занятие';

  const about =
    units.length === 0
      ? 'занятие без привязки к компетенции'
      : `${COMPETENCY_TITLE[units[0]]}${units[1] ? `, затем ${COMPETENCY_TITLE[units[1]].toLowerCase()}` : ''}`;

  const taskId = scenario?.practiceTaskId;
  const task = taskId ? TASK_BY_ID[taskId as keyof typeof TASK_BY_ID] : undefined;

  /**
   * На показе нет когнитивного упражнения: занятие целиком про выход на
   * площадку. Взять сюда `practiceWhy` значило бы рассказать педагогу про
   * упражнение, которого не будет, — и он бы его искал в плане встречи.
   */
  const why = lesson.isShowcase
    ? 'На показе не проверяют, а смотрят. Одиннадцать занятий дети пробовали понемногу; сегодня у них есть зритель, и больше ничего нового не происходит.'
    : (scenario?.practiceWhy ??
      'Упражнение нужно, чтобы навык был действием: его нельзя выполнить «правильно», можно только попробовать по-разному.');

  const watchFor = lesson.isShowcase
    ? 'Смотрите на площадку и на зал. Ребёнок может сидеть рядом, а не в центре, и это уже выход. Отказ — тоже информация: он говорит про ступень, а не про ребёнка.'
    : (WATCH_FOR[task?.skill ?? ''] ?? 'Видно по участию: ребёнок пробует, даже если не выходит с первого раза.');

  const keep =
    scenario?.growth ??
    'Разные варианты — не «правильные» и «неправильные». Задача занятия — попробовать больше одного и назвать, чем они отличаются.';

  const askYourself = scenario?.question ?? 'Что из этого занятия переносится в обычную жизнь детей?';

  const brief: Omit<QuickBrief, 'seconds'> = {
    lesson: lesson.number,
    unitTitle: lesson.isShowcase ? `${unitTitle}: показ` : unitTitle,
    scenes: lessonScenes(lesson),
    about,
    whatChildrenDo: whatChildrenDo(taskId, lesson.isShowcase),
    why,
    watchFor,
    keep,
    askYourself,
  };

  return { ...brief, seconds: readingSeconds(brief) };
}

/**
 * Названия историй занятия.
 *
 * Разбор без них одинаков у всех занятий одной компетенции: у семи уроков
 * саморегуляции был один текст. Педагог, открыв разбор седьмой раз, не находит
 * в нём ничего про своё занятие — и перестаёт открывать.
 */
function lessonScenes(lesson: Lesson): string[] {
  const titles: string[] = [];
  for (const dayIndex of lesson.dayIndexes) {
    const scenario = SCENARIO_BY_ID[PROGRAM_DAY_ID(dayIndex)];
    const title = scenario?.variants?.['8-10']?.title;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles.slice(0, 2);
}

/** Идентификатор дня для сценария: индекс дня 0 → `w1d1`. */
function PROGRAM_DAY_ID(dayIndex: number): string {
  const week = Math.floor(dayIndex / 5) + 1;
  const day = (dayIndex % 5) + 1;
  return `w${week}d${day}`;
}

/**
 * Сколько читать.
 *
 * Не 60 и не 90 «по стандарту»: считаем по объёму текста при 160 словах в
 * минуту — это медленное чтение с листа, не про себя. Число нужно, чтобы
 * обещание «разбор на минуту» можно было проверить, а не заявить.
 */
function readingSeconds(brief: Omit<QuickBrief, 'seconds'>): number {
  const text = [
    brief.about,
    brief.scenes.join(' '),
    brief.whatChildrenDo,
    brief.why,
    brief.watchFor,
    brief.keep,
    brief.askYourself,
  ].join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(20, Math.round((words / 160) * 60));
}

/** Все 36 разборов в порядке года. */
export function quickBriefs(year: { lessons: Lesson[] }): QuickBrief[] {
  return year.lessons.map(quickBrief);
}

/** Разборы только на показы — самые напряжённые занятия. */
export function showcaseBriefs(year: { lessons: Lesson[] }): QuickBrief[] {
  return year.lessons.filter((lesson) => lesson.isShowcase).map(quickBrief);
}

/** Сумма времени на все разборы: ею проверяется обещание «я не трачу вечер». */
export function totalBriefMinutes(briefs: QuickBrief[]): number {
  return Math.round(briefs.reduce((sum, brief) => sum + brief.seconds, 0) / 60);
}
