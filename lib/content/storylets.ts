import { WEEK_TWELVE_STORYLETS } from './storylets-week-twelve.ts';
import { WEEK_ELEVEN_STORYLETS } from './storylets-week-eleven.ts';
import { WEEK_TEN_STORYLETS } from './storylets-week-ten.ts';
import { WEEK_NINE_STORYLETS } from './storylets-week-nine.ts';
import { WEEK_EIGHT_STORYLETS } from './storylets-week-eight.ts';
import { WEEK_SEVEN_STORYLETS } from './storylets-week-seven.ts';
import { WEEK_SIX_STORYLETS } from './storylets-week-six.ts';
import type { Scenario } from './softskills';
import { WEEK_ONE_EXTRA_STORYLETS } from './storylets-week-one.ts';
import { DAYS_FIVE_SEVEN_STORYLETS } from './storylets-days-five-seven.ts';
import { DAYS_EIGHT_TEN_STORYLETS } from './storylets-days-eight-ten.ts';
import { DAYS_ELEVEN_THIRTEEN_STORYLETS } from './storylets-days-eleven-thirteen.ts';
import { DAYS_FOURTEEN_SIXTEEN_STORYLETS } from './storylets-days-fourteen-sixteen.ts';
import { DAYS_SEVENTEEN_NINETEEN_STORYLETS } from './storylets-days-seventeen-nineteen.ts';
import { DAYS_TWENTY_TWENTYTWO_STORYLETS } from './storylets-days-twenty-twentytwo.ts';
import { DAYS_TWENTYTHREE_TWENTYFIVE_STORYLETS } from './storylets-days-twentythree-twentyfive.ts';

/** Original extra stories for days 1–60. Expert and device review is still required. */
export const STORYLET_SCENARIOS: Scenario[] = [
  {
    id: 'w1d1_music', competency: 'self_awareness', skillLabel: 'Замечаем чувства', practiceTaskId: 'stroop',
    practiceWhy: 'Игра помогает потренировать внимание и паузу перед выбором.',
    home: 'Если хочется, предложите вместе послушать любимую мелодию.',
    report: 'Ребёнок исследовал историю о выборе подходящего занятия.',
    growth: 'Один и тот же звук может нравиться людям по-разному.',
    question: 'Как предложить другому выбор, не торопя его?',
    variants: {
      '5-7': { title: 'Тихая мелодия', text: 'Мира включила музыку, а Лис прикрыл уши. Мира не знает, громко ли ему. Что она может предложить?', options: [
        { text: 'Спросить, сделать ли тише', quality: 'good', note: 'Лис может ответить так, как ему удобно.' },
        { text: 'Предложить посидеть в тишине', quality: 'partial', note: 'Можно предложить паузу и принять ответ Лиса.' },
        { text: 'Выбрать музыку вместе', quality: 'bad', note: 'Вместе можно поискать то, что подходит обоим.' },
      ] },
      '8-10': { title: 'Репетиция в комнате', text: 'Друзья репетируют музыку. Тима отошёл к окну и молчит. Мира не знает, что он чувствует. Как она может поступить?', options: [
        { text: 'Спросить, удобно ли ему слушать', quality: 'good', note: 'Тима может рассказать или не отвечать.' },
        { text: 'Предложить сделать перерыв', quality: 'partial', note: 'Перерыв можно предложить, не заставляя никого.' },
        { text: 'Договориться о громкости вместе', quality: 'bad', note: 'Участники могут обсудить, что им подходит.' },
      ] },
      '11-13': { title: 'Звук для всех', text: 'Команда готовит выступление. Во время проверки звука один участник отошёл в сторону. Причина неизвестна. Что можно сделать?', options: [
        { text: 'Спросить, комфортна ли ему громкость', quality: 'good', note: 'Вопрос помогает узнать, не делая предположений.' },
        { text: 'Предложить участникам короткую паузу', quality: 'partial', note: 'Пауза — возможность, а не обязанность рассказывать о себе.' },
        { text: 'Обсудить удобный уровень звука всей командой', quality: 'bad', note: 'Общее обсуждение позволяет каждому предложить вариант.' },
      ] },
    },
  },
  {
    id: 'w1d1_picture', competency: 'self_awareness', skillLabel: 'Замечаем чувства', practiceTaskId: 'stroop',
    practiceWhy: 'Игра помогает тренировать внимание перед действием.',
    home: 'По желанию можно нарисовать вместе или каждому отдельно.',
    report: 'Ребёнок рассмотрел способы предложить поддержку без давления.',
    growth: 'Можно помогать по-разному и уважать отказ.',
    question: 'Как узнать, нужна ли человеку помощь?',
    variants: {
      '5-7': { title: 'Листок улетел', text: 'Рисунок Тимы унесло ветром. Он смотрит вслед листку. Что Лис может ему предложить?', options: [
        { text: 'Спросить, поискать ли рисунок вместе', quality: 'good', note: 'Тима сам решит, нужна ли ему помощь.' },
        { text: 'Предложить новый лист', quality: 'partial', note: 'Новый лист может пригодиться, если Тима захочет.' },
        { text: 'Подождать рядом', quality: 'bad', note: 'Можно просто быть рядом и не торопить Тиму.' },
      ] },
      '8-10': { title: 'Незаконченный рисунок', text: 'На выставке рисунок Миры упал с доски. Мира ещё не сказала, хочет ли его поправить. Как можно предложить помощь?', options: [
        { text: 'Спросить, прикрепить ли рисунок снова', quality: 'good', note: 'Спросить — значит оставить решение Мире.' },
        { text: 'Предложить поискать крепление вместе', quality: 'partial', note: 'Совместный поиск — предложение, от которого можно отказаться.' },
        { text: 'Подождать, пока Мира решит', quality: 'bad', note: 'Время подумать тоже может пригодиться.' },
      ] },
      '11-13': { title: 'Выставка идей', text: 'Во время подготовки выставки лист с проектом Тимы повредился. Тима смотрит на него, но ничего не говорит. Как предложить поддержку?', options: [
        { text: 'Спросить, нужна ли ему помощь с листом', quality: 'good', note: 'Вопрос оставляет Тиме возможность согласиться или отказаться.' },
        { text: 'Предложить материалы на выбор', quality: 'partial', note: 'Материалы пригодятся, если он сам решит ими воспользоваться.' },
        { text: 'Дать время и остаться поблизости', quality: 'bad', note: 'Не всегда нужно сразу действовать или требовать объяснений.' },
      ] },
    },
  },
  ...WEEK_ONE_EXTRA_STORYLETS,
  ...DAYS_FIVE_SEVEN_STORYLETS,
  ...DAYS_EIGHT_TEN_STORYLETS,
  ...DAYS_ELEVEN_THIRTEEN_STORYLETS,
  ...DAYS_FOURTEEN_SIXTEEN_STORYLETS,
  ...DAYS_SEVENTEEN_NINETEEN_STORYLETS,
  ...DAYS_TWENTY_TWENTYTWO_STORYLETS,
  ...DAYS_TWENTYTHREE_TWENTYFIVE_STORYLETS,
  ...WEEK_SIX_STORYLETS,
  ...WEEK_SEVEN_STORYLETS,
  ...WEEK_EIGHT_STORYLETS,
  ...WEEK_NINE_STORYLETS,
  ...WEEK_TEN_STORYLETS,
  ...WEEK_ELEVEN_STORYLETS,
  ...WEEK_TWELVE_STORYLETS,
];
export const STORYLETS_BY_ID = Object.fromEntries(STORYLET_SCENARIOS.map(story => [story.id, story]));
