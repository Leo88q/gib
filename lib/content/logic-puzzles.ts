import type { AgeBand } from '../types.ts';

export type LogicBoard = {
  mode: 'add' | 'subtract' | 'compare' | 'sequence';
  values: number[];
  /** For the youngest age group, the original addends can be counted interactively. */
  counters?: number[];
};
export type LogicPuzzle = { title: string; prompt: string; hint?: string; board: LogicBoard; solution: number; choices: number[] };

type Random = () => number;
function int(random: Random, max: number) { return Math.floor(random() * max); }
function mixed<T>(random: Random, input: T[]): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) { const j = int(random, i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

/** Generated data only describes the question. The answer is kept server-side. */
export function logicPuzzle(level: number, band: AgeBand, random: Random = Math.random): LogicPuzzle {
  const max = band === '5-7' ? 10 : band === '8-10' ? (level >= 3 ? 50 : 20) : (level >= 3 ? 100 : 50);
  const modes: LogicBoard['mode'][] = band === '5-7' ? ['add', 'compare', 'sequence'] : ['add', 'subtract', 'compare', 'sequence'];
  const mode = modes[int(random, modes.length)];
  let title = '', prompt = '', hint: string | undefined, values: number[], solution: number, counters: number[] | undefined;
  if (mode === 'add') {
    const a = band === '5-7' ? 1 + int(random, 5) : 2 + int(random, Math.floor(max / 2) - 1);
    const b = band === '5-7' ? 1 + int(random, Math.min(5, max - a)) : 1 + int(random, Math.min(Math.floor(max / 2), max - a));
    values = [a, b]; solution = a + b;
    title = 'Собери монетки'; prompt = `У Лиса ${a} монеток, а у друга ${b}. Сколько монеток вместе?`;
    if (band === '5-7') { counters = values; hint = 'Можно отмечать монетки по одной и считать вслух.'; }
  } else if (mode === 'subtract') {
    const a = 3 + int(random, max - 2);
    const b = 1 + int(random, a);
    values = [a, b]; solution = a - b;
    title = 'Монетки для дела'; prompt = `Было ${a} монеток. Лис потратил ${b}. Сколько осталось?`;
    hint = 'Отними потраченные монетки от всех.';
  } else if (mode === 'compare') {
    values = mixed(random, Array.from({ length: max }, (_, i) => i + 1)).slice(0, 3);
    solution = Math.max(...values);
    title = 'Что больше?'; prompt = 'Выбери самое большое число на табличках.';
  } else {
    const stepMax = band === '5-7' ? 1 : band === '8-10' ? Math.min(3, level + 1) : Math.min(5, level + 2);
    const step = 1 + int(random, stepMax);
    const start = 1 + int(random, max - 3 * step);
    values = [start, start + step, start + 2 * step]; solution = start + 3 * step;
    title = 'Продолжи ряд'; prompt = 'Каждый раз прибавляется одно и то же число. Выбери следующее число.';
    hint = 'Посмотри, как число меняется от одной таблички к другой.';
  }
  const choices = mode === 'compare' ? mixed(random, values) : mixed(random, [solution, ...mixed(random, Array.from({ length: max + 1 }, (_, i) => i).filter(n => n !== solution && Math.abs(n - solution) <= 4)).slice(0, 3)]);
  return { title, prompt, hint, board: { mode, values, ...(counters ? { counters } : {}) }, solution, choices };
}
