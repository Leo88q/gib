import type { AgeBand, SkillId } from '../types';
import { PLANS, planSteps, planDependencies } from './planning.ts';
import { logicPuzzle, type LogicBoard } from './logic-puzzles.ts';

/**
 * Когнитивные задания. Каждое построено на опубликованной научной парадигме
 * (Stroop, Corsi block tapping, digit span, go/no-go, trail-making-подобное
 * переключение правил, Tower-of-London-подобное планирование) — лицензия на
 * методы не требуется, реализация оригинальная.
 *
 * Источники парадигм: Stroop 1935; Corsi 1982; Wechsler (digit span);
 * Shallice 1982 (Tower of London); Eriksen & Eriksen (flanker);
 * Reitan (Trail Making Test B).
 */

export type ShapeCard = { shape: string; color: string };

export type ChoiceOption = {
  id: string;
  label: string;
  correct: boolean;
  color?: string;
};

export type TaskInstance = {
  taskId: string;
  skill: SkillId;
  title: string;
  prompt: string;
  hint?: string;
  rounds?: import('./support-practice').SupportRound[];
  kind: 'choice' | 'memory' | 'symbol-memory' | 'digits' | 'gonogo' | 'finddiff' | 'cards' | 'order' | 'switch-rounds' | 'social-practice';
  options?: ChoiceOption[];
  bigText?: string;
  bigColor?: string;
  cards?: ShapeCard[];
  targetCard?: ShapeCard;
  ruleLabel?: string;
  rules?: ('shape' | 'color')[];
  logicBoard?: LogicBoard;
  steps?: string[];
  rows?: number;
  cols?: number;
  cells?: number[];
  digits?: number[];
  grid?: { color: string; target: boolean }[];
  /** Ключ ответа. Хранится только на сервере и не отправляется клиенту. */
  answer?: { index?: number; cells?: number[]; digits?: string; targets?: number[]; before?: [number, number][] };
};

export const COLORS = [
  { name: 'красный', css: 'red' },
  { name: 'синий', css: 'blue' },
  { name: 'зелёный', css: 'green' },
  { name: 'жёлтый', css: 'yellow' },
  { name: 'фиолетовый', css: 'purple' },
  { name: 'оранжевый', css: 'orange' },
];

export const SHAPES = ['circle', 'square', 'triangle', 'star', 'heart', 'diamond'];

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]): T => arr[rnd(arr.length)];
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ------------------------------------------------------------------ */
/* 1. Stroop — торможение                                             */
/* ------------------------------------------------------------------ */
function stroop(level: number, band: AgeBand): TaskInstance {
  const word = pick(COLORS);
  const incongruentChance = band === '5-7' ? 0.2 : band === '8-10' ? 0.65 : 0.85;
  const ink = Math.random() < incongruentChance ? pick(COLORS.filter(c => c.name !== word.name)) : word;
  // При несовпадении смысл слова должен присутствовать среди вариантов.
  const distractorCount = level >= 3 ? 3 : 2;
  const distractors = ink.name === word.name ? [] : [word];
  distractors.push(...shuffle(COLORS.filter(c => c.name !== ink.name && c.name !== word.name)).slice(0, distractorCount - distractors.length));
  const options = shuffle([ink, ...distractors]).map((c) => ({
    id: c.name,
    label: c.name,
    color: c.css,
    correct: c.name === ink.name,
  }));
  return {
    taskId: 'stroop',
    skill: 'inhibition',
    title: 'Цвет слова',
    prompt: 'Слово написано одним цветом. Выбери ЦВЕТ слова, а не его значение.',
    hint: 'Смотри на буквы, а не на смысл слова.',
    kind: 'choice',
    bigText: word.name.toUpperCase(),
    bigColor: ink.css,
    options,
    answer: { index: options.findIndex((o) => o.correct) },
  };
}

/* ------------------------------------------------------------------ */
/* 2. Corsi-подобная сетка — рабочая память                            */
/* ------------------------------------------------------------------ */
function memoryGrid(level: number, band: AgeBand): TaskInstance {
  const size = band === '5-7' ? 3 : 4;
  const maxCells = band === '5-7' ? 4 : band === '8-10' ? 6 : 7;
  const count = Math.min(level + 1, maxCells);
  const total = size * size;
  const cells = shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, count);
  return {
    taskId: 'memory-grid',
    skill: 'working_memory',
    title: 'Запомни и повтори',
    prompt: 'Посмотри, какие клетки загорелись. Повтори их по порядку.',
    kind: 'memory',
    rows: size,
    cols: size,
    cells,
    answer: { cells },
  };
}

/* Последовательность значков: форма и цвет вместо координат. */
function symbolMemory(level: number, band: AgeBand): TaskInstance {
  const shapes = shuffle(SHAPES);
  const colors = shuffle(COLORS);
  const cards = shapes.map((shape, i) => ({ shape, color: colors[i].css }));
  const max = band === '5-7' ? 3 : band === '8-10' ? 4 : 5;
  const count = Math.min(Math.max(2, level + 1), max);
  const cells = shuffle(cards.map((_, i) => i)).slice(0, count);
  return {
    taskId: 'symbol-memory', skill: 'working_memory', title: 'Цепочка значков',
    prompt: 'Запомни, какие значки загораются, и повтори их по порядку.',
    hint: 'Каждый значок появляется только один раз.',
    kind: 'symbol-memory', rows: 2, cols: 3, cards, cells, answer: { cells },
  };
}

/* ------------------------------------------------------------------ */
/* 3. Цифровой ряд — объём памяти                                      */
/* ------------------------------------------------------------------ */
function digitSpan(level: number, band: AgeBand): TaskInstance {
  const maxLen = band === '5-7' ? 3 : band === '8-10' ? 5 : 6;
  const len = Math.min(level + 1, maxLen);
  const digits = Array.from({ length: len }, () => rnd(10));
  return {
    taskId: 'digit-span',
    skill: 'working_memory',
    title: 'Цифры по памяти',
    prompt: 'Запомни цифры и набери их по порядку.',
    kind: 'digits',
    digits,
    answer: { digits: digits.join('') },
  };
}

/* ------------------------------------------------------------------ */
/* 4. Поиск отличий — внимание и зрительный поиск                       */
/* ------------------------------------------------------------------ */
function findDiff(level: number, band: AgeBand): TaskInstance {
  const size = band === '5-7' ? 3 : 4;
  const total = size * size;
  const diffCount = Math.min(level, band === '5-7' ? 2 : 3);
  const baseShape = pick(SHAPES);
  const baseColor = pick(COLORS).css;
  const diffIndexes = new Set<number>();
  while (diffIndexes.size < diffCount) diffIndexes.add(rnd(total));
  const grid: { shape: string; color: string; diff: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const isDiff = diffIndexes.has(i);
    // Differences can be in shape, color, or both; never accidentally identical.
    const change = isDiff ? rnd(3) : -1;
    grid.push({
      shape: change === 0 || change === 2 ? pick(SHAPES.filter(s => s !== baseShape)) : baseShape,
      color: change === 1 || change === 2 ? pick(COLORS.filter(c => c.css !== baseColor)).css : baseColor,
      diff: isDiff,
    });
  }
  return {
    taskId: 'find-diff',
    skill: 'attention',
    title: 'Найди отличия',
    prompt: 'Нажми на все фигурки, которые отличаются от остальных.',
    hint: 'Сравнивай форму и цвет.',
    kind: 'finddiff',
    rows: size,
    cols: size,
    cards: grid.map((g) => ({ shape: g.shape, color: g.color })),
    answer: { cells: [...diffIndexes].sort((a, b) => a - b) },
  };
}

/* Поиск пар: совпадение сразу по двум признакам. */
function findMatch(level: number, band: AgeBand): TaskInstance {
  const size = band === '5-7' ? 3 : 4;
  const total = size * size;
  const targetCard = { shape: pick(SHAPES), color: pick(COLORS).css };
  const otherShapes = SHAPES.filter(shape => shape !== targetCard.shape);
  const otherColors = COLORS.filter(color => color.css !== targetCard.color);
  const count = Math.min(2 + Math.floor(Math.max(1, level) / 2), band === '5-7' ? 3 : 5);
  const cards: ShapeCard[] = Array.from({ length: count }, () => ({ ...targetCard }));
  // Guarantee shape-only and color-only lures so both attributes matter.
  const remaining = total - count;
  for (let i = 0; i < remaining; i++) {
    const kind = i < 2 ? i : rnd(3);
    cards.push({
      shape: kind === 0 ? targetCard.shape : pick(otherShapes),
      color: kind === 1 ? targetCard.color : pick(otherColors).css,
    });
  }
  const mixed = shuffle(cards);
  return {
    taskId: 'find-match', skill: 'attention', title: 'Найди пары',
    prompt: 'Найди все фигурки, которые совпадают с образцом по форме и цвету.',
    hint: 'Проверь оба признака: похожие фигурки могут отличаться цветом или формой.',
    kind: 'finddiff', rows: size, cols: size, cards: mixed, targetCard,
    answer: { cells: mixed.flatMap((card, index) => card.shape === targetCard.shape && card.color === targetCard.color ? [index] : []) },
  };
}

/* ------------------------------------------------------------------ */
/* 5. Смена правила — когнитивная гибкость                             */
/* ------------------------------------------------------------------ */
function ruleSwitch(_level: number, _band: AgeBand): TaskInstance {
  const byShape = Math.random() < 0.5;
  const shape = pick(SHAPES);
  const otherShape = pick(SHAPES.filter(s => s !== shape));
  const color = pick(COLORS).css;
  const otherColor = pick(COLORS.filter(c => c.css !== color)).css;
  const shapeOdd = rnd(4);
  // Два разных кандидата: без прочтения правила решение неоднозначно.
  const colorOdd = (shapeOdd + 1 + rnd(3)) % 4;
  const cards = Array.from({ length: 4 }, (_, i) => ({
    shape: i === shapeOdd ? otherShape : shape,
    color: i === colorOdd ? otherColor : color,
  }));
  return {
    taskId: 'rule-switch',
    skill: 'flexibility',
    title: 'Правило может поменяться',
    prompt: 'Выбери фигурку, которая не подходит под правило.',
    hint: 'Есть две необычные фигурки. Выбирай только по указанному правилу.',
    kind: 'cards',
    cards,
    ruleLabel: byShape ? 'Лишняя по ФОРМЕ' : 'Лишняя по ЦВЕТУ',
    answer: { index: byShape ? shapeOdd : colorOdd },
  };
}

/** Одни и те же карточки, но правило меняется после каждого шага. */
function switchRounds(level: number, band: AgeBand): TaskInstance {
  const base = ruleSwitch(level, band);
  const cards = base.cards!;
  const shapeOdd = cards.findIndex(card => cards.filter(c => c.shape === card.shape).length === 1);
  const colorOdd = cards.findIndex(card => cards.filter(c => c.color === card.color).length === 1);
  const first: 'shape' | 'color' = base.ruleLabel!.includes('ФОРМЕ') ? 'shape' : 'color';
  const second = first === 'shape' ? 'color' : 'shape';
  const rules: ('shape' | 'color')[] = [first, second];
  if (band !== '5-7' && level >= 3) rules.push(first);
  return {
    taskId: 'switch-rounds', skill: 'flexibility', title: 'Правило меняется',
    prompt: 'Найди лишнюю фигурку по правилу. Затем правило изменится!',
    hint: 'Карточки те же, но правило меняется. Смотри, что нужно сравнить сейчас.',
    kind: 'switch-rounds', cards, rules,
    answer: { cells: rules.map(rule => rule === 'shape' ? shapeOdd : colorOdd) },
  };
}

/* ------------------------------------------------------------------ */
/* 6. Go/No-Go — импульс-контроль                                      */
/* ------------------------------------------------------------------ */
function goNoGo(level: number, band: AgeBand): TaskInstance {
  const size = 3;
  const total = size * size;
  const targetCount = Math.max(1, 3 - Math.floor(level / 2));
  const distractorCount = Math.max(1, total - targetCount);
  const targetColors = band === '5-7' ? ['green'] : ['green'];
  const distract = COLORS.filter((c) => c.css !== 'green');
  const cells: { color: string; target: boolean }[] = [];
  for (let i = 0; i < targetCount; i++) {
    cells.push({ color: targetColors[0], target: true });
  }
  for (let i = 0; i < distractorCount; i++) {
    cells.push({ color: distract[i % distract.length].css, target: false });
  }
  const mixed = shuffle(cells);
  return {
    taskId: 'go-nogo',
    skill: 'inhibition',
    title: 'Только зелёные',
    prompt: 'Нажимай только на ЗЕЛЁНЫЕ. На остальные — не нажимай.',
    kind: 'gonogo',
    grid: mixed,
    answer: { targets: mixed.map((c, i) => (c.target ? i : -1)).filter((i) => i >= 0) },
  };
}

/* ------------------------------------------------------------------ */
/* 7. Планирование порядка действий                                     */
/* ------------------------------------------------------------------ */
function planOrder(level: number, band: AgeBand): TaskInstance {
  const template = pick(PLANS[band]);
  const good = planSteps(template, band, level);
  let shuffled = shuffle(good.map((label, order) => ({ label, order })));
  // A fresh puzzle should not already be in the exact expected order.
  if (shuffled.every((step, i) => step.order === i)) shuffled = [...shuffled.slice(1), shuffled[0]];
  return {
    taskId: 'plan-order',
    skill: 'planning',
    title: 'Построй план',
    prompt: `Цель: «${template.goal}». Собери предложенный план по порядку.`,
    hint: 'Читай внимательно: многие шаги связаны с предыдущими. Порядок можно изменить.',
    kind: 'order',
    steps: shuffled.map(step => step.label),
    answer: {
      cells: good.map((_, order) => shuffled.findIndex(step => step.order === order)),
      before: planDependencies(template, band, level).map(([a, b]) => [shuffled.findIndex(step => step.order === a), shuffled.findIndex(step => step.order === b)]),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 8. Логика и скорость счёта                                          */
/* ------------------------------------------------------------------ */
function logic(level: number, band: AgeBand): TaskInstance {
  const puzzle = logicPuzzle(level, band);
  const options = puzzle.choices.map(value => ({ id: String(value), label: String(value), correct: value === puzzle.solution }));
  return {
    taskId: 'logic', skill: 'logic', title: puzzle.title, prompt: puzzle.prompt,
    hint: puzzle.hint, kind: 'choice', logicBoard: puzzle.board, options,
    answer: { index: options.findIndex(option => option.correct) },
  };
}

/* ------------------------------------------------------------------ */

export type TaskDef = {
  id: string;
  skill: SkillId;
  title: string;
  targetMs: number;
  make: (level: number, band: AgeBand) => TaskInstance;
};

export const TASKS: TaskDef[] = [
  { id: 'stroop', skill: 'inhibition', title: 'Цвет слова', targetMs: 9000, make: stroop },
  { id: 'go-nogo', skill: 'inhibition', title: 'Только зелёные', targetMs: 12000, make: goNoGo },
  { id: 'memory-grid', skill: 'working_memory', title: 'Запомни и повтори', targetMs: 15000, make: memoryGrid },
  { id: 'digit-span', skill: 'working_memory', title: 'Цифры по памяти', targetMs: 15000, make: digitSpan },
  { id: 'symbol-memory', skill: 'working_memory', title: 'Цепочка значков', targetMs: 15000, make: symbolMemory },
  { id: 'find-diff', skill: 'attention', title: 'Найди отличия', targetMs: 20000, make: findDiff },
  { id: 'find-match', skill: 'attention', title: 'Найди пары', targetMs: 20000, make: findMatch },
  { id: 'rule-switch', skill: 'flexibility', title: 'Правило меняется', targetMs: 14000, make: ruleSwitch },
  { id: 'switch-rounds', skill: 'flexibility', title: 'Смена правил', targetMs: 30000, make: switchRounds },
  { id: 'plan-order', skill: 'planning', title: 'Порядок действий', targetMs: 20000, make: planOrder },
  { id: 'logic', skill: 'logic', title: 'Счёт и логика', targetMs: 8000, make: logic },
];

export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

/** По навыку берём одну из доступных задач (при наличии нескольких — по кругу). */
export function taskForSkill(skill: SkillId, rotation = 0): TaskDef {
  const list = TASKS.filter((t) => t.skill === skill);
  return list[rotation % list.length];
}
