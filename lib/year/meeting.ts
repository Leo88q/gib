/**
 * План встречи: что педагог делает 40 минут.
 *
 * Зачем это нужно. Год из 36 занятий до сих пор существовал как расписание: даты,
 * отметки, темы. Но расписание не отвечает на вопрос, который педагог задаёт
 * первым: «а что я делаю в четверг в 16:00?» Без ответа год остаётся формой без
 * содержания, а занятие — поводом собраться.
 *
 * Откуда берётся план. Ни одного нового слова не придумано: всё собрано из уже
 * написанного контента.
 *
 *   сценарии дней занятия  →  разбор (что было, какие варианты выбирали)
 *   навыки дней занятия    →  тренировка (когнитивное задание)
 *   homeIdeas темы         →  практика в парах
 *   weekQuestion темы      →  итог круга
 *   isShowcase             →  показ вместо разбора
 *
 * Почему именно такой порядок. Сначала круг и разбор — чтобы дети пришли в себя
 * и вспомнили, что было дома. Потом тренировка, пока внимание не село. Потом
 * практика в парах, где навык становится действием, а не словом. В конце — итог
 * на одну фразу, без обсуждения оценок.
 *
 * Чего в плане нет и не будет:
 *  - оценок детей и «хорошо ли справился»;
 *  - сбора причин отсутствия;
 *  - домашних заданий как обязанности (только идеи для дома);
 *  - обязательных выступлений: показ — приглашение, а не требование.
 */

import { PROGRAM_DAYS, SCENARIO_BY_ID, weekByNumber } from '../content/program/index.ts';
import { SKILL_LABEL } from '../content/program/types.ts';
import { TASK_BY_ID } from '../content/cognitive.ts';
import type { Lesson } from '../content/year/types.ts';

/** Один блок встречи: что делаем, сколько минут, зачем. */
export type MeetingBlock = {
  /** Название блока для педагога: короткое, чтобы читалось с листа. */
  title: string;
  /** Минуты. Сумма всегда 40 — это длина встречи в расписании. */
  minutes: number;
  /** Что делает педагог: одно-два предложения, без методической воды. */
  lead: string;
  /** Что делают дети. Пустое — если блок целиком про разговор. */
  children: string;
};

export type MeetingPlan = {
  lesson: number;
  /** Тема и её название: педагогу нужно понимать, о чём неделя. */
  unit: number;
  unitTitle: string;
  /** Навыки занятия человеческими словами, без идентификаторов. */
  skills: string[];
  blocks: MeetingBlock[];
  /** Что взять с собой. Ничего покупать не нужно — так и написано. */
  materials: string[];
  /** Одна фраза, которой заканчивается встреча. */
  closing: string;
};

/** Длина встречи. Одно занятие в неделю — 40 минут, как школьный урок. */
export const MEETING_MINUTES = 40;

/**
 * Сколько блоков и по сколько минут.
 *
 * Числа не «красивые», а от нагрузки: круг 5 минут — это двадцать детей по
 * пятнадцать секунд; разбор 10 — потому что рассказывать про домашнюю практику
 * дольше не выдержит никто; тренировка 10 — когнитивное задание само по себе
 * короткое, но с объяснением и повтором выходит десятка; практика 10 — пары
 * успевают две роли; итог 5 — по фразе с каждого, без обсуждения.
 */
const BLOCKS = [5, 10, 10, 10, 5] as const;

/** Названия блоков для показа, включая показ вместо разбора. */
export function blockTitles(isShowcase: boolean): string[] {
  return [
    'Круг: кто здесь и как дела',
    isShowcase ? 'Показ: что получилось' : 'Разбор: что было дома',
    'Тренировка: навык в действии',
    'Практика в парах',
    'Итог: одна фраза',
  ];
}

/**
 * Когнитивное задание занятия: то, что ребёнок уже видел в симуляторе.
 *
 * Материалов на бумаге нет: задания живут в приложении и генерируются. Поэтому
 * в плане написано «покажите на экране», а не «раздайте карточки»: карточек не
 * существует, и обещать их педагогу нельзя.
 */
function practiceOf(lesson: Lesson): { title: string; why: string } | undefined {
  for (const item of scenariosOf(lesson)) {
    const id = item.scenario.practiceTaskId;
    if (!id) continue;
    // Педагогу нужно название, а не идентификатор: «stroop» ничего не говорит
    // тому, кто не читал код. Если задания с таким id нет — не выдумываем.
    const task = TASK_BY_ID[id];
    if (task) return { title: task.title, why: item.scenario.practiceWhy };
  }
  return undefined;
}

/** Сценарии дней занятия — источник разбора. */
function scenariosOf(lesson: Lesson) {
  return lesson.dayIndexes
    .map((index) => PROGRAM_DAYS[index])
    .filter(Boolean)
    .map((entry) => ({ day: entry.day, scenario: SCENARIO_BY_ID[entry.day.scenarioId] }))
    .filter((item) => Boolean(item.scenario));
}

/**
 * Вопрос сценария — детский, а не родительский.
 *
 * Поле `question` в сценарии адресовано семье («как можно предложить поддержку,
 * не настаивая на разговоре?»), и его можно задать детям. Поле `home` и
 * `weekQuestion` адресованы родителю и о ребёнке в третьем лице — их в круг
 * детям отдавать нельзя. Поэтому источник разный и это проверяется тестом.
 */
/**
 * Строка, которой можно закрыть встречу.
 *
 * `growth` сценария — единственный текст, который написан ребёнку и при этом
 * не оценивает его: «чувства и желание говорить о них у каждого могут быть
 * разными». Советы родителю (`parentNote`, `homeIdeas`, `weekQuestion`) сюда не
 * годятся даже с пометкой «не читать вслух».
 */
function growthLine(lesson: Lesson): string {
  for (const item of scenariosOf(lesson)) {
    if (item.scenario.growth) return item.scenario.growth;
  }
  return 'у каждого свой способ, и это нормально';
}

function childQuestionOf(lesson: Lesson): string {
  for (const item of scenariosOf(lesson)) {
    const question = item.scenario.question;
    if (question) return question;
  }
  return 'что было самым трудным на этой неделе?';
}

/** Темы сценариев занятия: одна строка, чтобы педагог видел, о чём говорить. */
function themesLine(lesson: Lesson): string {
  const titles = scenariosOf(lesson).map((item) => `«${item.scenario.variants['8-10'].title}»`);
  if (titles.length === 0) return 'Темы дней этой недели.';
  return `Дети проходили: ${titles.join(', ')}.`;
}

/**
 * План встречи по номеру занятия.
 *
 * `undefined`, если занятия с таким номером нет: вызывающий решает, что делать,
 * а не получает выдуманный план.
 */
export function meetingPlan(lesson: Lesson): MeetingPlan {
  const week = weekByNumber(lesson.unit);
  const skills = Array.from(new Set(lesson.skills)).map((skill) => SKILL_LABEL[skill] ?? skill);
  const titles = blockTitles(lesson.isShowcase);

  const scenarioCount = scenariosOf(lesson).length;
  const practice = practiceOf(lesson);

  const blocks: MeetingBlock[] = [
    {
      title: titles[0],
      minutes: BLOCKS[0],
      lead: 'Спросите каждого по кругу одним словом: как дела. Без «почему» и без разбора ответа.',
      children: 'Отвечают одним словом. Можно промолчать — это тоже ответ.',
    },
    {
      title: titles[1],
      minutes: BLOCKS[1],
      lead: lesson.isShowcase
        ? 'Пригласите показать то, что получилось дома. Показ — приглашение, а не очередь: кто не хочет, не выходит.'
        : `Разберите домашнюю практику по дням этой встречи — их ${scenarioCount}. Вопрос один: «что ты выбрал и что было потом».`,
      children: lesson.isShowcase
        ? 'Показывают по желанию. Смотрящие называют одно, что заметили, — без «правильно» и «молодец».'
        : themesLine(lesson),
    },
    {
      title: titles[2],
      minutes: BLOCKS[2],
      lead: practice
        ? `Откройте задание «${practice.title}» на экране. ${practice.why} Объясните один раз, покажите пример.`
        : `Тренировка на ${skills.join(' и ').toLowerCase()}: одно задание из приложения, объяснение, пример.`,
      children: 'Делают задание, затем повторяют его в паре: один делает, другой смотрит.',
    },
    {
      title: titles[3],
      minutes: BLOCKS[3],
      lead: `Одна ситуация из жизни, где нужен этот навык. Задайте вопрос: «${childQuestionOf(lesson)}». Разбейте на пары, по две роли.`,
      children: 'Проигрывают ситуацию в парах, потом меняются ролями: в каждой роли по разу.',
    },
    {
      title: titles[4],
      minutes: BLOCKS[4],
      // Вопрос недели адресован родителю и говорит о ребёнке в третьем лице.
      // Детям он не подходит, поэтому итог — тем же вопросом, что и практика.
      lead: `Вернитесь к вопросу встречи: «${childQuestionOf(lesson)}». На ответ — одна фраза, без обсуждения и без вывода.`,
      children: 'Отвечают одной фразой по кругу. Отвечать можно «не знаю».',
    },
  ];

  const total = blocks.reduce((sum, block) => sum + block.minutes, 0);
  if (total !== MEETING_MINUTES) {
    // Ошибка в минутах — это не мелочь: 45 минут вместо 40 ломают школьное
    // расписание, а педагог узнает об этом на встрече, а не в коде.
    throw new Error(`Meeting plan must total ${MEETING_MINUTES} minutes, got ${total}`);
  }

  return {
    lesson: lesson.number,
    unit: lesson.unit,
    unitTitle: week.title,
    skills,
    blocks,
    materials: [
      'Проектор или планшет с открытым приложением: задания там, бумажных карточек нет',
      'Лист и ручка для каждого ребёнка',
    ],
    // Закрывающая фраза — та, которую можно сказать вслух. Родительских текстов
    // в плане нет вообще: поле, адресованное семье, рано или поздно прочитают
    // группе. Поэтому здесь только `growth` сценария — он написан ребёнку.
    closing: `Скажите вслух: «${growthLine(lesson)}»`,
  };
}
