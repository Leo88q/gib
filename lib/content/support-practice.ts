import { WEEK_TWELVE_EXTRA_PRACTICES } from './program/week-twelve-extra-practices.ts';
import { WEEK_ELEVEN_EXTRA_PRACTICES } from './program/week-eleven-extra-practices.ts';
import { WEEK_TEN_EXTRA_PRACTICES } from './program/week-ten-extra-practices.ts';
import { WEEK_NINE_EXTRA_PRACTICES } from './program/week-nine-extra-practices.ts';
import { WEEK_EIGHT_EXTRA_PRACTICES } from './program/week-eight-extra-practices.ts';
import { WEEK_SEVEN_EXTRA_PRACTICES } from './program/week-seven-extra-practices.ts';
import { WEEK_SIX_EXTRA_PRACTICES } from './program/week-six-extra-practices.ts';
import type { AgeBand } from '../types';
import type { TaskInstance } from './cognitive';
import { REMAINING_DAYS } from './program/remaining-content.ts';
import { REMAINING_PRACTICES } from './program/remaining-practices.ts';
import { WEEK_FOUR_PRACTICES } from './program/week-four-practices.ts';
import { WEEKS_FIVE_SIX_PRACTICES } from './program/weeks-five-six-practices.ts';
import { WEEKS_SEVEN_EIGHT_PRACTICES } from './program/weeks-seven-eight-practices.ts';
import { WEEKS_NINE_TEN_PRACTICES } from './program/weeks-nine-ten-practices.ts';
import { WEEKS_ELEVEN_TWELVE_PRACTICES } from './program/weeks-eleven-twelve-practices.ts';
import { WEEK_THREE_PRACTICES } from './program/week-three-practices.ts';
import { DAYS_TWENTYTHREE_TWENTYFIVE_PRACTICES } from './program/days-twentythree-twentyfive-practices.ts';
import { DAYS_TWENTY_TWENTYTWO_PRACTICES } from './program/days-twenty-twentytwo-practices.ts';
import { DAYS_SEVENTEEN_NINETEEN_PRACTICES } from './program/days-seventeen-nineteen-practices.ts';
import { DAYS_FOURTEEN_SIXTEEN_PRACTICES } from './program/days-fourteen-sixteen-practices.ts';
import { DAYS_ELEVEN_THIRTEEN_PRACTICES } from './program/days-eleven-thirteen-practices.ts';
import { DAYS_EIGHT_TEN_PRACTICES } from './program/days-eight-ten-practices.ts';
import { DAYS_FIVE_SEVEN_PRACTICES } from './program/days-five-seven-practices.ts';
import { WEEK_ONE_EXTRA_PRACTICES } from './program/week-one-extra-practices.ts';
import { WEEKS_ONE_TWO_PRACTICES } from './program/weeks-one-two-practices.ts';

export type SupportRound = { prompt: string; options: [string, string, string] };
const choices: [string, string, string][] = [
  ['Спросить, нужна ли помощь', 'Предложить немного подождать', 'Предложить побыть рядом'],
  ['Предложить два варианта', 'Спросить, что удобнее', 'Дать время подумать'],
  ['Уважить ответ и не настаивать', 'Сказать, что помощь доступна позже', 'Предложить заняться чем-то другим'],
];
const scenes: Record<string, Record<AgeBand, [string, string, string]>> = {
  w1d1: {
    '5-7': ['Лис ищет краски и задумался.', 'Лис решает, искать сейчас или позже.', 'Лис пока не хочет говорить.'],
    '8-10': ['Мира смотрит на помятую поделку.', 'Мира думает, поправить её или сделать перерыв.', 'Мира пока не готова обсуждать поделку.'],
    '11-13': ['Тима отошёл после обсуждения проекта.', 'Тима выбирает, вернуться к проекту или сделать паузу.', 'Тима пока не хочет обсуждать встречу.'],
  },
  w1d2: {
    '5-7': ['Лис думает, как провести минутку для себя.', 'Лис выбирает: рисовать, выбрать значок или ничего не делать.', 'Лис не хочет показывать свой рисунок.'],
    '8-10': ['Мира выбирает, хочет ли она сделать отметку.', 'Мира думает, отметить состояние или пропустить.', 'Мира пока не хочет делиться своим выбором.'],
    '11-13': ['Тима рассматривает разные способы заметить своё состояние.', 'Тима решает, делать отметку или нет.', 'Тима предпочитает оставить выбор при себе.'],
  },
  w1d3: {
    '5-7': ['Лис присел после игры.', 'Лис выбирает, посидеть или попросить воды.', 'Лису сейчас удобно немного помолчать.'],
    '8-10': ['Мира делает паузу после активной игры.', 'Мира выбирает, где ей отдохнуть.', 'Мира пока не хочет обсуждать свой отдых.'],
    '11-13': ['Тима делает перерыв после репетиции.', 'Тима решает, где и как отдохнуть.', 'Тима пока не хочет обсуждать паузу.'],
  },
  w1d4: {
    '5-7': ['Башня Лиса наклонилась.', 'Лис выбирает: построить иначе или сделать перерыв.', 'Лис пока не хочет советов.'],
    '8-10': ['Макет Миры получился не таким, как она ожидала.', 'Мира решает, переделать макет или отложить его.', 'Мира пока не хочет советов.'],
    '11-13': ['Проект Тимы отличается от первоначального плана.', 'Тима выбирает, изменить проект или переключиться.', 'Тима пока не хочет обсуждать проект.'],
  },
  w1d5: {
    '5-7': ['Лис думает о карточке для игры.', 'Лис выбирает: нарисовать героя или не делать карточку.', 'Лис не хочет показывать свой рисунок.'],
    '8-10': ['Мира выбирает, хочет ли она делать карточку.', 'Мира решает, рассказать о теме или придумать персонажа.', 'Мира не хочет показывать карточку.'],
    '11-13': ['Тима рассматривает идею карточек для команды.', 'Тима выбирает: придумать героя или отказаться.', 'Тима предпочитает не делиться своим решением.'],
  },
  w2d1: {
    '5-7': ['Лису предложили игру, а он ещё не решил.', 'Лис хочет узнать, во что будут играть.', 'Лис решил пока не играть.'],
    '8-10': ['Миру пригласили в игру с незнакомыми правилами.', 'Мира хочет узнать больше об игре.', 'Мира решила пока не участвовать.'],
    '11-13': ['Тиму пригласили в проект, и он ещё думает.', 'Тима хочет уточнить условия участия.', 'Тима решил не участвовать.'],
  },
  w2d2: {
    '5-7': ['Лис хочет отдохнуть после игры.', 'Лис выбирает, что делать во время передышки.', 'Лис решил спокойно посидеть.'],
    '8-10': ['Мира хочет сделать паузу в занятии.', 'Мира выбирает занятие на время отдыха.', 'Мира выбрала тихое место.'],
    '11-13': ['Тима хочет сделать перерыв во время проекта.', 'Тима выбирает, как провести перерыв.', 'Тима решил немного побыть в тишине.'],
  },
  w2d3: {
    '5-7': ['Друг взял кубики Лиса без спроса.', 'Лис думает, как попросить вернуть кубики.', 'Лис хочет помощи взрослого.'],
    '8-10': ['Материалы Миры взяли без спроса.', 'Мира думает, как попросить вернуть материалы.', 'Мира хочет попросить взрослого помочь.'],
    '11-13': ['Материалы Тимы использовали без разрешения.', 'Тима рассматривает варианты вернуть материалы.', 'Тима хочет обратиться к доверенному взрослому.'],
  },
  w2d4: {
    '5-7': ['В мастерской громко, и Лис хочет передышку.', 'Лис выбирает, где отдохнуть.', 'Лис хочет, чтобы знакомый взрослый побыл рядом.'],
    '8-10': ['На репетиции громко, Мира хочет паузу.', 'Мира выбирает, где провести передышку.', 'Мира хочет попросить взрослого помочь.'],
    '11-13': ['Команда Тимы обсуждает проект в шумной комнате.', 'Тима выбирает, где сделать перерыв.', 'Тима хочет попросить поддержки взрослого.'],
  },
  w2d5: {
    '5-7': ['Лис придумывает коробку идей для отдыха.', 'Лис выбирает выдуманную идею.', 'Лис пока не хочет добавлять идеи.'],
    '8-10': ['Мира рассматривает набор вымышленных идей для отдыха.', 'Мира выбирает, хочет ли что-то добавить.', 'Мира пока не хочет делиться выбором.'],
    '11-13': ['Тима рассматривает вымышленные варианты перерыва.', 'Тима решает, нужен ли ему список идей.', 'Тима не хочет составлять личный план.'],
  },
  w3d1: {
    '5-7': ['Друг Лиса сидит отдельно от игры.', 'Лис хочет предложить поддержку.', 'Друг пока не хочет разговаривать.'],
    '8-10': ['Друг Миры отошёл от игры.', 'Мира думает, как предложить поддержку.', 'Друг не хочет обсуждать ситуацию.'],
    '11-13': ['Участник команды отошёл после встречи.', 'Тима рассматривает варианты поддержки.', 'Участник пока не хочет разговаривать.'],
  },
  w3d2: {
    '5-7': ['Лис не понял правило игры.', 'Лис выбирает, как спросить о правиле.', 'Друг предлагает объяснить позже.'],
    '8-10': ['Мира не поняла часть идеи для поделки.', 'Мира думает, как уточнить идею.', 'Друг готов показать пример позже.'],
    '11-13': ['Тима не понял сообщение о проекте.', 'Тима выбирает, как уточнить смысл.', 'Участник предлагает обсудить сообщение позже.'],
  },
  w3d3: {
    '5-7': ['Друг отказался играть с Лисом.', 'Лис выбирает, чем заняться.', 'Друг пока не хочет объяснять отказ.'],
    '8-10': ['Друг отказался делать поделку с Мирой.', 'Мира выбирает следующее занятие.', 'Друг не хочет объяснять решение.'],
    '11-13': ['Друг отказался участвовать в проекте Тимы.', 'Тима думает, как продолжить проект.', 'Друг не хочет обсуждать причины отказа.'],
  },
  w3d4: {
    '5-7': ['Друг Лиса тихо рисует.', 'Лис не знает, хочет ли друг компанию.', 'Друг хочет продолжить рисовать один.'],
    '8-10': ['Друг Миры рисует отдельно.', 'Мира не знает, нужна ли ему помощь.', 'Друг хочет побыть один.'],
    '11-13': ['Участник команды отвечает коротко.', 'Тима не знает причины и хочет предложить помощь.', 'Участник не хочет обсуждать ситуацию.'],
  },
  w3d5: {
    '5-7': ['Лис выбирает, играть ли с новым участником.', 'Лис хочет узнать правила игры.', 'Лис решил выбрать другую игру.'],
    '8-10': ['Мире предложили проект с новым участником.', 'Мира хочет узнать условия проекта.', 'Мира решила отказаться от участия.'],
    '11-13': ['Тиму пригласили в новую команду.', 'Тима хочет уточнить условия участия.', 'Тима решил сохранить дистанцию.'],
  },
  w1d1_music: {
    '5-7': ['Лис отошёл от громкой музыки.', 'Друзья думают, слушать музыку или побыть в тишине.', 'Лис пока не хочет выбирать музыку.'],
    '8-10': ['Тима отошёл от репетиции к окну.', 'Друзья выбирают громкость для продолжения.', 'Тима пока не хочет обсуждать музыку.'],
    '11-13': ['Участник отошёл во время проверки звука.', 'Команда выбирает, продолжить или сделать паузу.', 'Участник пока не готов обсуждать звук.'],
  },
  w1d1_picture: {
    '5-7': ['Рисунок Тимы улетел.', 'Тима думает, искать рисунок или взять новый лист.', 'Тима пока не хочет рассказывать о рисунке.'],
    '8-10': ['Рисунок Миры упал с доски.', 'Мира выбирает, прикрепить рисунок или отложить его.', 'Мира пока не готова обсуждать выставку.'],
    '11-13': ['Лист с проектом Тимы повредился.', 'Тима решает, восстановить лист сейчас или позже.', 'Тима пока не хочет обсуждать проект.'],
  },
};

/** Responses are specific to the situation, not graded or ordered by quality. */
const themedChoices: Record<string, [string, string, string][]> = {
  w3d1: [
    ['Спросить, нужна ли помощь', 'Предложить побыть рядом', 'Обратиться к знакомому взрослому'],
    ['Предложить разговор без обязательства', 'Предложить компанию', 'Попросить взрослого помочь'],
    ['Уважить отказ от разговора', 'Предложить помощь позже', 'Обратиться к взрослому, если нужна помощь'],
  ],
  w3d2: [
    ['Предложить спросить ещё раз', 'Предложить попросить пример', 'Дать время подумать'],
    ['Помочь сформулировать вопрос', 'Предложить попросить показать', 'Предложить вернуться позже'],
    ['Договориться спросить позже', 'Принять решение подождать', 'Предложить другое занятие'],
  ],
  w3d3: [
    ['Принять отказ', 'Предложить другое занятие', 'Дать каждому время выбрать'],
    ['Предложить заняться своим делом', 'Предложить перерыв', 'Предложить изменить план'],
    ['Не требовать объяснений', 'Уважить личное пространство', 'Обсудить другую тему'],
  ],
  w3d4: [
    ['Не делать догадок о чувствах', 'Спросить, нужна ли помощь', 'Продолжить своё дело'],
    ['Предложить компанию без давления', 'Спросить, нужна ли помощь', 'Оставить пространство'],
    ['Уважить желание побыть одному', 'Предложить помощь позже', 'Продолжить своё занятие'],
  ],
  w3d5: [
    ['Предложить узнать условия', 'Предложить обратиться к взрослому', 'Напомнить, что можно отказаться'],
    ['Помочь сформулировать вопрос', 'Предложить время подумать', 'Обратиться к знакомому взрослому'],
    ['Уважить решение', 'Не требовать объяснений', 'Поддержать выбор личного пространства'],
  ],
  w2d1: [
    ['Спросить, нужно ли время', 'Предложить узнать правила', 'Сказать, что можно отказаться'],
    ['Вместе уточнить правила', 'Дать время подумать', 'Предложить спросить позже'],
    ['Уважить решение', 'Предложить вернуться позже', 'Предложить другое занятие'],
  ],
  w2d2: [
    ['Спросить, нужна ли помощь', 'Предложить посидеть', 'Предложить тихое место'],
    ['Предложить рисунок', 'Предложить просто посидеть', 'Спросить, что удобно'],
    ['Уважить выбранную паузу', 'Предложить побыть рядом', 'Дать время отдохнуть'],
  ],
  w2d3: [
    ['Предложить попросить вернуть вещь', 'Предложить обратиться к взрослому', 'Спросить, нужна ли помощь'],
    ['Помочь подобрать слова просьбы', 'Предложить обратиться к взрослому', 'Дать время подумать'],
    ['Помочь найти знакомого взрослого', 'Предложить пойти вместе', 'Оставаться рядом, если это удобно'],
  ],
  w2d4: [
    ['Спросить, нужна ли помощь', 'Предложить паузу', 'Предложить найти место потише'],
    ['Вместе поискать тихое место', 'Спросить, что удобно', 'Предложить помощь взрослого'],
    ['Помочь позвать взрослого', 'Предложить побыть рядом', 'Уважать выбранную передышку'],
  ],
  w2d5: [
    ['Предложить нарисовать вымышленную идею', 'Сказать, что можно не выбирать', 'Предложить подумать позже'],
    ['Предложить два варианта отдыха', 'Дать время подумать', 'Напомнить, что можно пропустить'],
    ['Уважить решение', 'Сказать, что выбор можно изменить', 'Предложить другое занятие'],
  ],
};

export function hasSupportPractice(scenarioId: string): boolean { return Object.hasOwn(scenes, scenarioId) || Object.hasOwn(REMAINING_DAYS, scenarioId) || Object.hasOwn(WEEK_ONE_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(DAYS_FIVE_SEVEN_PRACTICES, scenarioId) || Object.hasOwn(DAYS_EIGHT_TEN_PRACTICES, scenarioId) || Object.hasOwn(DAYS_ELEVEN_THIRTEEN_PRACTICES, scenarioId) || Object.hasOwn(DAYS_FOURTEEN_SIXTEEN_PRACTICES, scenarioId) || Object.hasOwn(DAYS_SEVENTEEN_NINETEEN_PRACTICES, scenarioId) || Object.hasOwn(DAYS_TWENTY_TWENTYTWO_PRACTICES, scenarioId) || Object.hasOwn(DAYS_TWENTYTHREE_TWENTYFIVE_PRACTICES, scenarioId) || Object.hasOwn(WEEK_SIX_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_SEVEN_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_EIGHT_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_NINE_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_TEN_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_ELEVEN_EXTRA_PRACTICES, scenarioId) || Object.hasOwn(WEEK_TWELVE_EXTRA_PRACTICES, scenarioId); }

/** Original unscored activity. All options are invitations, not assessments of a child. */
export function makeSupportPractice(band: AgeBand, scenarioId: string): TaskInstance {
  const early = WEEK_TWELVE_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_ELEVEN_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_TEN_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_NINE_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_EIGHT_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_SEVEN_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEK_SIX_EXTRA_PRACTICES[scenarioId]?.[band] ?? DAYS_TWENTYTHREE_TWENTYFIVE_PRACTICES[scenarioId]?.[band] ?? DAYS_TWENTY_TWENTYTWO_PRACTICES[scenarioId]?.[band] ?? DAYS_SEVENTEEN_NINETEEN_PRACTICES[scenarioId]?.[band] ?? DAYS_FOURTEEN_SIXTEEN_PRACTICES[scenarioId]?.[band] ?? DAYS_ELEVEN_THIRTEEN_PRACTICES[scenarioId]?.[band] ?? DAYS_EIGHT_TEN_PRACTICES[scenarioId]?.[band] ?? DAYS_FIVE_SEVEN_PRACTICES[scenarioId]?.[band] ?? WEEK_ONE_EXTRA_PRACTICES[scenarioId]?.[band] ?? WEEKS_ONE_TWO_PRACTICES[scenarioId]?.[band] ?? WEEK_THREE_PRACTICES[scenarioId]?.[band];
  if (early) return {
    taskId: 'support-practice', skill: 'inhibition', kind: 'social-practice',
    title: 'Мастерская поддержки', prompt: 'Выбери по одной идее для каждой карточки. Практику можно пропустить.',
    rounds: early.map(card => ({ prompt: card.prompt, options: [...card.options] as [string, string, string] })),
  };
  const day = REMAINING_DAYS[scenarioId];
  if (day) {
    const bandIndex = ({ '5-7': 0, '8-10': 1, '11-13': 2 } as const)[band];
    const continuation = REMAINING_PRACTICES[scenarioId];
    if (bandIndex === undefined || !continuation) throw Error('unknown_support_practice');
    const adapted = WEEK_FOUR_PRACTICES[scenarioId]?.[band] ?? WEEKS_FIVE_SIX_PRACTICES[scenarioId]?.[band] ?? WEEKS_SEVEN_EIGHT_PRACTICES[scenarioId]?.[band] ?? WEEKS_NINE_TEN_PRACTICES[scenarioId]?.[band] ?? WEEKS_ELEVEN_TWELVE_PRACTICES[scenarioId]?.[band];
    return {
      taskId: 'support-practice', skill: 'inhibition', kind: 'social-practice',
      title: 'Мастерская идей',
      prompt: 'Представь историю и собери идеи. Здесь нет единственного ответа; практику можно пропустить.',
      rounds: (adapted ?? [
        { prompt: day.situation[bandIndex], options: day.actions },
        ...continuation,
      ]).map(card => ({ prompt: card.prompt, options: [...card.options] as [string, string, string] })),
    };
  }
  const prompts = hasSupportPractice(scenarioId) ? scenes[scenarioId]?.[band] : undefined;
  if (!prompts) throw Error('unknown_support_practice');
  const options = themedChoices[scenarioId] ?? choices;
  const rounds: SupportRound[] = prompts.map((prompt, i) => ({ prompt, options: [...options[i]] as [string, string, string] }));
  return {
    taskId: 'support-practice', skill: 'inhibition', kind: 'social-practice',
    title: 'Мастерская поддержки',
    prompt: 'Собери три идеи поддержки. Здесь нет единственного ответа: можно изменить выбор.',
    rounds,
  };
}
