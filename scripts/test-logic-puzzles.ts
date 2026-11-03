import { logicPuzzle } from '../lib/content/logic-puzzles.ts';
import type { AgeBand } from '../lib/types.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw new Error(message); }
let seed = 481516;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) for (let level = 1; level <= 5; level++) {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const p = logicPuzzle(level, band, random);
    const { mode, values, counters } = p.board; seen.add(mode);
    const max = band === '5-7' ? 10 : band === '8-10' ? (level >= 3 ? 50 : 20) : (level >= 3 ? 100 : 50);
    check(p.choices.length === (mode === 'compare' ? 3 : 4), 'нужное число вариантов');
    check(new Set(p.choices).size === p.choices.length && p.choices.filter(x => x === p.solution).length === 1, 'уникальные варианты и единственный ответ');
    check([...values, ...p.choices, p.solution].every(n => Number.isInteger(n) && n >= 0 && n <= max), 'числа в возрастных пределах');
    if (mode === 'add') check(values[0] + values[1] === p.solution, 'сложение');
    if (mode === 'subtract') check(values[0] - values[1] === p.solution && values[1] <= values[0], 'вычитание без отрицательного ответа');
    if (mode === 'compare') check(Math.max(...values) === p.solution && new Set(values).size === 3, 'однозначный максимум');
    if (mode === 'sequence') check(values[1] - values[0] === values[2] - values[1] && p.solution - values[2] === values[1] - values[0], 'арифметический ряд');
    check(Boolean(counters) === (band === '5-7' && mode === 'add'), 'монетки только в младшей группе для сложения');
    if (counters) check(counters[0] === values[0] && counters[1] === values[1] && counters.every(n => n <= 5), 'монетки совпадают с условием');
  }
  check(seen.size === (band === '5-7' ? 3 : 4), 'все типы упражнений доступны');
}
console.log('Логика: 15 000 генераций, возрастные диапазоны, решения и наглядность проверены');
