/**
 * Сводка метода для школы: один документ, который можно отдать завучу.
 *
 * Зачем это нужно. У метода три разных описания: программа на 48 занятий,
 * сценарий видео и то, что реально работает в продукте. Школа получает первое,
 * продукт делает третье, и расхождение обнаруживается на первом же занятии.
 * Здесь одно описание, собранное **из кода**, а не из документа: числа не
 * вводятся руками, а считаются по году, темам и плану встречи.
 *
 * Что здесь есть:
 *  - сколько занятий, по сколько минут, какие темы и в каком порядке;
 *  - что делает педагог 40 минут (по блокам, с суммой);
 *  - как устроены возрастные линейки;
 *  - что проверяется и чем (без слова «диагностика» и без обещаний);
 *  - что нужно от школы.
 *
 * Чего здесь нет и не будет:
 *  - обещаний роста оценок, IQ и «успешности»;
 *  - процентов эффективности;
 *  - слова «диагностика»: наблюдение и разговор — не диагноз;
 *  - медицинских формулировок.
 */

import { YEAR } from '../content/year/index.ts';
import { PROGRAM, TOTAL_DAYS } from '../content/program/index.ts';
import { MEETING_MINUTES, meetingPlan } from './meeting.ts';
import { STAGE_INFO } from './stages.ts';
import { BODY_UNITS } from './safety-body.ts';
import { SHOWCASE_ANCHORS } from './lessons.ts';

/** Один пункт сводки: коротко и проверяемо. */
export type SchoolFact = {
  /** О чём пункт: «Занятий в году». */
  label: string;
  /** Значение: «36». */
  value: string;
  /** Откуда взято — чтобы завуч мог проверить, а не поверить. */
  source: string;
};

/**
 * Проверяемые факты о курсе.
 *
 * Каждое число считается из кода. Если год изменится, сводка изменится вместе
 * с ним — и разойтись с продуктом не сможет.
 */
export function schoolFacts(): SchoolFact[] {
  const showcase = YEAR.lessons.filter((lesson) => lesson.isShowcase).length;
  const totalMinutes = YEAR.lessons.length * MEETING_MINUTES;
  return [
    {
      label: 'Занятий в году',
      value: String(YEAR.lessons.length),
      source: 'lib/content/year/types.ts — LESSONS_PER_UNIT',
    },
    {
      label: 'Длина встречи',
      value: `${MEETING_MINUTES} минут`,
      source: 'lib/year/meeting.ts — MEETING_MINUTES',
    },
    {
      label: 'Академических часов за год',
      value: String(Math.round((totalMinutes / 45) * 10) / 10),
      source: `${YEAR.lessons.length} × ${MEETING_MINUTES} минут ÷ 45`,
    },
    {
      label: 'Тем в программе',
      value: String(PROGRAM.length),
      source: 'lib/content/program/index.ts — PROGRAM',
    },
    {
      label: 'Историй для домашней практики',
      value: String(TOTAL_DAYS),
      source: 'lib/content/program/index.ts — TOTAL_DAYS',
    },
    {
      label: 'Показов за год',
      value: String(showcase),
      source: 'по одному на тему: LESSONS_PER_UNIT, последнее занятие темы',
    },
    {
      label: 'Возрастные линейки',
      value: '5–7, 8–10, 11–13',
      source: 'lib/types.ts — AgeBand',
    },
    {
      label: 'Тем с телесными упражнениями',
      value: String(BODY_UNITS.length),
      source: 'lib/year/safety-body.ts — BODY_UNITS',
    },
  ];
}

/**
 * Структура курса по темам: что проходит группа по порядку.
 *
 * Без «модулей» и «блоков»: тема — это несколько занятий подряд, у каждой свой
 * вопрос, и вопрос адресован ребёнку, а не методисту.
 */
export function schoolOutline(): { unit: number; title: string; lessons: number; showcase: boolean }[] {
  return PROGRAM.map((week) => {
    const lessons = YEAR.lessons.filter((lesson) => lesson.unit === week.week);
    return {
      unit: week.week,
      title: week.title,
      lessons: lessons.length,
      showcase: lessons.some((lesson) => lesson.isShowcase),
    };
  });
}

/** Что делает педагог на встрече: блоки и минуты, без привязки к теме. */
export function schoolMeetingBlocks(): { title: string; minutes: number }[] {
  const plan = meetingPlan(YEAR.lessons[0]);
  return plan.blocks.map((block) => ({ title: block.title, minutes: block.minutes }));
}

/**
 * Три этапа года в том виде, в каком их понимает школа.
 *
 * Не «четверти» и не «модули»: этап отвечает на вопрос, что происходит с
 * группой, а не что пройдено по плану.
 */
export function schoolStages(): { title: string; task: string; question: string }[] {
  return [STAGE_INFO.opening, STAGE_INFO.middle, STAGE_INFO.closing].map((stage) => ({
    title: stage.title,
    task: stage.task,
    question: stage.question,
  }));
}

/**
 * Что измеряется и чем.
 *
 * Формулировки намеренно скромные: «наблюдаем», «спрашиваем», «фиксируем», а не
 * «диагностируем» и «оцениваем». Причина не в осторожности, а в том, что
 * продукт этого не умеет, и обещать школе больше нечего.
 */
export const SCHOOL_MEASURES: readonly { what: string; how: string; limit: string }[] = [
  {
    what: 'Выход на показ',
    how: `Три отметки: «${SHOWCASE_ANCHORS[0].toLowerCase()}», «${SHOWCASE_ANCHORS[1].toLowerCase()}», «${SHOWCASE_ANCHORS[2].toLowerCase()}».`,
    limit: 'Качество выступления не оценивается: оценка превращает показ в экзамен.',
  },
  {
    what: 'Посещение',
    how: 'Отметка «был / не был» на каждом занятии. Процент не выводится и родителю не показывается.',
    limit: 'Причина отсутствия не собирается: это данные о семье, а не о ребёнке.',
  },
  {
    what: 'Домашняя практика',
    how: 'Какие истории ребёнок прошёл и какие варианты выбирал.',
    limit: 'Выбор варианта не оценивается: правильного ответа в истории нет.',
  },
  {
    what: 'Разговор',
    how: 'Вопрос этапа на входе, в середине и в конце года — ребёнку и семье.',
    limit: 'Ответ словами не переводится в балл и не сравнивается между детьми.',
  },
];

/**
 * Что нужно от школы, чтобы курс вообще состоялся.
 *
 * Список короткий намеренно: длинный список требований читается как «нам
 * ничего не нужно, кроме денег».
 */
export const SCHOOL_NEEDS: readonly string[] = [
  'Один взрослый на группу до 12 детей; при группе больше 12 — второй взрослый на телесных упражнениях и показах.',
  'Помещение, где можно двигаться: столы сдвигаются, есть размеченная зона.',
  'Проектор или планшет с открытым приложением: задания и истории живут там, бумажных карточек нет.',
  'Согласие родителей на участие, отдельное — на фото и видео.',
  'Педагог, прошедший обучение методу: без него курс превращается в кружок по интересу.',
];

/**
 * Граница ответственности: что метод делает и чего не делает.
 *
 * Это тот слайд, который в видео назван «что можно и что нельзя утверждать».
 * Здесь он собран из того, что продукт действительно умеет.
 */
export const SCHOOL_LIMITS: readonly string[] = [
  'Курс развивает навыки общения и саморегуляции через практику, а не через объяснения.',
  'Он не заменяет работу психолога и не является помощью при трудностях, требующих специалиста.',
  'Он не обещает роста оценок: связь занятий с успеваемостью мы не измеряли.',
  'Результат зависит от педагога и группы, поэтому одинакового результата у всех не бывает.',
  'Данные о ребёнке остаются у семьи и у школы; публикуются только обезличенные сводки.',
];
