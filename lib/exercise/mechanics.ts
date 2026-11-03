import type { AgeBand } from '../types.ts';

/**
 * Игровая механика упражнений: как показывать задание, сколько ждать,
 * какую подсказку и управление предлагать каждому возрасту.
 *
 * Модуль описывает ТОЛЬКО представление. Ответы, ключи и награды остаются
 * серверными: правила здесь не знают правильного ответа и не меняют награду.
 * Ни одно возрастное правило не добавляет штрафов, оценок личности и
 * обязательных действий: у каждого задания остаются пауза и отложение.
 */

export type TaskKind =
  | 'choice'
  | 'memory'
  | 'symbol-memory'
  | 'digits'
  | 'gonogo'
  | 'finddiff'
  | 'cards'
  | 'order'
  | 'switch-rounds'
  | 'social-practice';

export type ControlsMode = 'tap' | 'tap-keyboard';

export type TaskPresentation = {
  band: AgeBand;
  /** Шаг в показе последовательности, мс. Уменьшение движения ставит его в 0. */
  showStepMs: number;
  /** Пауза между показом и вводом, мс (0 — без паузы). */
  showGapMs: number;
  /** Сколько раз можно пересмотреть последовательность до пометки «практика». */
  freeReplays: number;
  /** Крупная сетка для младших. */
  bigTargets: boolean;
  /** Показывать счётчик шагов и подписи номеров поверх сетки. */
  showStepBadges: boolean;
  /** Подсказывать жестом/стрелкой, что карточки можно передвигать. */
  showMoveHints: boolean;
  /** Инструкция, которую читает ребёнок. */
  instruction: string;
  /** Как отменить последний шаг. */
  undoHint: string;
  /** Дополнительная навигация клавиатурой или кнопками. */
  keyboardNotes: string;
  controls: ControlsMode;
};

const BAND_COPY: Record<TaskKind, Record<AgeBand, string>> = {
  choice: {
    '5-7': 'Нажми на один вариант. Перед тем как ответить, можно выбрать другой.',
    '8-10': 'Выбери один вариант и подтверди. До подтверждения выбор можно изменить.',
    '11-13': 'Выбери один вариант. Пока не подтвердил — можно поменять решение.',
  },
  memory: {
    '5-7': 'Смотри, какие клетки загораются. Потом нажми их в том же порядке.',
    '8-10': 'Запомни порядок клеток и повтори его нажатиями.',
    '11-13': 'Запомни последовательность и воспроизведи её в том же порядке.',
  },
  'symbol-memory': {
    '5-7': 'Смотри, какие значки зажигаются по очереди. Потом нажми их так же.',
    '8-10': 'Запомни порядок значков и повтори его.',
    '11-13': 'Запомни последовательность значков и воспроизведи её.',
  },
  digits: {
    '5-7': 'Посмотри на цифры. Потом набери их по порядку.',
    '8-10': 'Запомни цифры и набери их по порядку.',
    '11-13': 'Запомни ряд цифр и введи его в том же порядке.',
  },
  gonogo: {
    '5-7': 'Нажимай только на зелёные сигналы. Остальные не трогай.',
    '8-10': 'Отметь только зелёные сигналы и пропусти остальные.',
    '11-13': 'Выбери все зелёные сигналы, остальные оставь без отметки.',
  },
  finddiff: {
    '5-7': 'Нажми на фигурки, которые отличаются от других. Можно снять отметку.',
    '8-10': 'Отметь все отличающиеся фигурки. Отметку можно убрать повторным нажатием.',
    '11-13': 'Отметь все фигурки, отличающиеся от остальных; ошибочную отметку можно снять.',
  },
  cards: {
    '5-7': 'Выбери карточку, которая подходит под правило.',
    '8-10': 'Выбери одну карточку по правилу и подтверди.',
    '11-13': 'Определи карточку по указанному правилу и подтверди выбор.',
  },
  order: {
    '5-7': 'Нажимай на карточки в нужном порядке. Стрелки ↑ ↓ поменяют порядок.',
    '8-10': 'Составь план по порядку. Карточки можно поднимать и опускать.',
    '11-13': 'Собери последовательность шагов; порядок можно исправить стрелками.',
  },
  'switch-rounds': {
    '5-7': 'Правило меняется. Смотри, что сравнивать сейчас, и нажми карточку.',
    '8-10': 'Каждый раунд читай правило заново и выбирай подходящую карточку.',
    '11-13': 'Правило чередуется между раундами; ответ предыдущего раунда можно изменить.',
  },
  'social-practice': {
    '5-7': 'Выбери по идее для каждой ситуации. Правильного ответа тут нет.',
    '8-10': 'Собери по одной идее для каждой ситуации — это не оценивается.',
    '11-13': 'Выбери идеи для ситуаций или пропусти: награда не изменится.',
  },
};

/** Скорость показа последовательностей: младшим медленнее, старшим быстрее. */
const SHOW_STEP: Record<AgeBand, number> = { '5-7': 900, '8-10': 750, '11-13': 650 };
const SHOW_GAP: Record<AgeBand, number> = { '5-7': 700, '8-10': 600, '11-13': 500 };

export function taskPresentation(kind: TaskKind, band: AgeBand, reduceMotion = false): TaskPresentation {
  const young = band === '5-7';
  const teen = band === '11-13';
  return {
    band,
    // Уменьшение движения убирает подпрыгивания и вспышку, но не саму последовательность.
    showStepMs: reduceMotion ? 0 : SHOW_STEP[band],
    showGapMs: reduceMotion ? 0 : SHOW_GAP[band],
    freeReplays: young ? 2 : 1,
    bigTargets: young,
    showStepBadges: !teen,
    showMoveHints: !teen,
    instruction: BAND_COPY[kind][band],
    undoHint: young ? 'Нажми на выбранный кружок ещё раз, чтобы снять отметку.' : 'Отметку или шаг можно отменить: нажми повторно.',
    keyboardNotes: young
      ? 'Можно играть кнопками «Назад» и «Дальше» ниже.'
      : 'С клавиатуры: Tab — по карточкам, Enter — выбрать, стрелки — поменять порядок.',
    controls: 'tap-keyboard',
  };
}

/** Читаемая подпись клетки с учётом крупной сетки младших. */
export function targetLabel(index: number, cols: number, band: AgeBand): string {
  const row = Math.floor(index / cols) + 1;
  const column = (index % cols) + 1;
  if (band === '5-7') return `${row} ряд, ${column} место`;
  if (band === '8-10') return `ряд ${row}, столбец ${column}`;
  return `R${row}C${column}`;
}

/** Клавиатурные жесты применяются к одному и тому же ответу, что и нажатия. */
export type SequenceAction =
  | { type: 'focus'; index: number }
  | { type: 'select'; index: number }
  | { type: 'undo' }
  | { type: 'move'; position: number; direction: -1 | 1 }
  | { type: 'submit' };

/** Для последовательностей память важнее порядка нажатий: повтор клетки запрещён. */
export function applySequenceAction(selection: number[], action: SequenceAction, count: number): number[] {
  const clamp = (value: number) => Number.isInteger(value) && value >= 0 && value < count;
  switch (action.type) {
    case 'select': {
      if (!clamp(action.index) || selection.includes(action.index) || selection.length >= count) return selection;
      return [...selection, action.index];
    }
    case 'undo':
      return selection.slice(0, -1);
    case 'move': {
      const target = action.position + action.direction;
      if (action.position < 0 || action.position >= selection.length || target < 0 || target >= selection.length) return selection;
      const next = [...selection];
      [next[action.position], next[target]] = [next[target], next[action.position]];
      return next;
    }
    default:
      return selection;
  }
}

/** Сколько подсказок «повторить показ» осталось до пометки «практика». */
export function replaysBeforePractice(replays: number, band: AgeBand): number {
  return Math.max(0, Math.min(replays, band === '5-7' ? 2 : 1));
}

/** Заголовок окна задания: короткий, без оценок личности. */
export function exercisePanelTitle(kind: TaskKind, band: AgeBand): string {
  const label: Record<TaskKind, [string, string, string]> = {
    choice: ['Выбери ответ', 'Выбери ответ', 'Решение'],
    memory: ['Огоньки', 'Порядок огоньков', 'Последовательность'],
    'symbol-memory': ['Значки', 'Порядок значков', 'Последовательность значков'],
    digits: ['Цифры', 'Ряд цифр', 'Числовой ряд'],
    gonogo: ['Сигналы', 'Сигналы района', 'Все зелёные сигналы'],
    finddiff: ['Отличия', 'Найди отличия', 'Отбор по признаку'],
    cards: ['Правило', 'Правило карточек', 'Карточка по правилу'],
    order: ['План', 'Собери план', 'Планировщик'],
    'switch-rounds': ['Смена правила', 'Правило меняется', 'Переключение правил'],
    'social-practice': ['Книжка идей', 'Книжка идей', 'Мастерская идей'],
  };
  return label[kind][band === '5-7' ? 0 : band === '8-10' ? 1 : 2];
}

/**
 * Пауза и отложение не влияют на награду. Сервер принимает только явный
 * `skip` для необязательной практики, поэтому когнитивное задание «отложить»
 * можно лишь после сохранения ответа — правила описывают это честно.
 */
export const DEFER_RULES = {
  optionalPractice: {
    canDefer: true,
    rewardUnchanged: true,
    text: 'Пропустить упражнение? Миссия и награда не изменятся.',
  },
  cognitiveTask: {
    canDefer: false,
    rewardUnchanged: true,
    text: 'Задание нужно ответить или закрыть миссию — награда за миссию от этого не уменьшится.',
  },
} as const;
