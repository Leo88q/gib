import { PLANS, planSteps, planDependencies } from '../lib/content/planning.ts';
import { TASK_BY_ID, type TaskInstance } from '../lib/content/cognitive.ts';
import { checkTaskAnswer } from '../lib/engine/check-answer.ts';
import { toggleSelection, moveSelection } from '../lib/content/sequence-selection.ts';
import type { AgeBand } from '../lib/types.ts';
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function permutations(items: number[]): number[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((x, i) => permutations(items.filter((_, j) => j !== i)).map(rest => [x, ...rest]));
}
let alternativePlans = 0;
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) {
  check(PLANS[band].length >= 4, `${band}: разнообразие сюжетов`);
  for (const template of PLANS[band]) for (const level of [1, 2, 3, 4]) {
    const steps = planSteps(template, band, level);
    const deps = planDependencies(template, band, level);
    check(steps.length === (band === '5-7' ? level >= 2 ? 4 : 3 : level >= 3 ? 5 : 4), 'размер зависит от возраста и сложности');
    check(new Set(steps).size === steps.length && steps.every(s => s.trim().length > 10), 'шаги непустые и уникальные');
    check(deps.length > 0 && deps.every(([a, b]) => a >= 0 && a < b && b < steps.length), 'граф зависимостей ацикличный и в пределах плана');
    const task = { kind: 'order', answer: { cells: steps.map((_, i) => i), before: deps } } as TaskInstance;
    const possibilities = permutations(steps.map((_, i) => i));
    let accepted = 0;
    for (const cells of possibilities) {
      const valid = deps.every(([a, b]) => cells.indexOf(a) < cells.indexOf(b));
      check(checkTaskAnswer(task, { cells }) === valid, 'ответ точно соответствует зависимостям');
      if (valid) accepted++;
    }
    check(accepted > 0, 'существует хотя бы один правильный порядок');
    if (accepted > 1) alternativePlans++;
    check(!checkTaskAnswer(task, { cells: Array(steps.length).fill(0) }), 'дубли не проходят');
  }
  for (let i = 0; i < 100; i++) {
    const task = TASK_BY_ID['plan-order'].make(3, band);
    check(task.answer!.cells!.some((n, index) => n !== index), 'карточки не выданы уже в нужном порядке');
    check(checkTaskAnswer(task, { cells: task.answer!.cells }), 'ответ соответствует перемешанным карточкам');
  }
}
check(alternativePlans >= 2, 'независимые шаги допускают несколько правильных решений');
const old = { kind: 'order', answer: { cells: [2, 0, 1] } } as TaskInstance;
check(checkTaskAnswer(old, { cells: [2, 0, 1] }) && !checkTaskAnswer(old, { cells: [0, 2, 1] }), 'старые сохранённые задания проверяются по точному порядку');
let picked = toggleSelection([], 2); picked = toggleSelection(picked, 0); picked = toggleSelection(picked, 1);
check(JSON.stringify(picked) === '[2,0,1]', 'сборка последовательности');
check(JSON.stringify(moveSelection(picked, 1, -1)) === '[0,2,1]', 'перемещение шага вверх');
check(JSON.stringify(moveSelection(picked, 1, 1)) === '[2,1,0]', 'перемещение шага вниз');
check(JSON.stringify(moveSelection(picked, 0, -1)) === '[2,0,1]', 'краевые перемещения не меняют план');
check(JSON.stringify(toggleSelection(picked, 0)) === '[2,1]', 'удаление шага сохраняет остальные');
console.log('Возрастные планы: сюжеты, все перестановки, совместимость и редактирование проверены');
