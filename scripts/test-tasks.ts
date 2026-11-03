import { TASK_BY_ID } from '../lib/content/cognitive.ts';
import { checkTaskAnswer } from '../lib/engine/check-answer.ts';
import type { AgeBand } from '../lib/types.ts';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) {
  for (let level = 1; level <= 5; level++) {
    for (let i = 0; i < 100; i++) {
      const go = TASK_BY_ID['go-nogo'].make(level, band);
      check(go.grid?.length === 9, 'Сетка сигналов должна содержать 9 клеток');
      check(go.grid.some(x => x.target) && go.grid.some(x => !x.target), 'Нужны зелёные сигналы и отвлекающие');
      check(go.grid.every(x => x.target === (x.color === 'green')), 'Зелёный сигнал соответствует ответу');
      check(checkTaskAnswer(go, { targets: [...go.answer!.targets!].reverse() }), 'Порядок сигналов не важен');
      const logic = TASK_BY_ID.logic.make(level, band);
      const answers = logic.options?.filter(o => o.correct) ?? [];
      check(answers.length === 1, 'В логической задаче ровно один ответ');
      if (logic.title === 'Что больше?') {
        const nums = logic.options!.map(o => Number(o.label));
        check(new Set(nums).size === nums.length, 'Числа не повторяются');
        check(Number(answers[0].label) === Math.max(...nums), 'Максимум соответствует ответу');
      }
      const diff = TASK_BY_ID['find-diff'].make(level, band);
      check(checkTaskAnswer(diff, { cells: [...diff.answer!.cells!].reverse() }), 'Порядок отличий не важен');
      const memory = TASK_BY_ID['memory-grid'].make(level, band);
      check(checkTaskAnswer(memory, { cells: memory.answer!.cells }), 'Последовательность памяти принимается');
      check(!checkTaskAnswer(memory, { cells: [...memory.answer!.cells!].reverse() }), 'Последовательность памяти требует правильного порядка');
      const plan = TASK_BY_ID['plan-order'].make(level, band);
      check(plan.kind === 'order' && !!plan.steps && new Set(plan.steps).size === plan.steps.length, 'План состоит из уникальных шагов');
      const order = plan.answer!.cells!;
      check(order.length === plan.steps!.length && new Set(order).size === order.length, 'Ответ плана — перестановка шагов');
      check(checkTaskAnswer(plan, { cells: order }), 'Правильный порядок плана принимается');
      check(!checkTaskAnswer(plan, { cells: [...order].reverse() }), 'Другой порядок плана неверен');
      const rule = TASK_BY_ID['rule-switch'].make(level, band);
      const shapeCounts = new Map<string, number>(), colorCounts = new Map<string, number>();
      for (const c of rule.cards!) { shapeCounts.set(c.shape, (shapeCounts.get(c.shape) ?? 0) + 1); colorCounts.set(c.color, (colorCounts.get(c.color) ?? 0) + 1); }
      const oddShape = rule.cards!.findIndex(c => shapeCounts.get(c.shape) === 1);
      const oddColor = rule.cards!.findIndex(c => colorCounts.get(c.color) === 1);
      check(oddShape >= 0 && oddColor >= 0 && oddShape !== oddColor, 'Разные карточки выделяются формой и цветом');
      check(rule.answer!.index === (rule.ruleLabel!.includes('ФОРМЕ') ? oddShape : oddColor), 'Ответ соответствует указанному правилу');
      const stroop = TASK_BY_ID.stroop.make(level, band);
      const word = stroop.bigText!.toLowerCase();
      const ink = stroop.options!.find(o => o.correct)!;
      check(ink.color === stroop.bigColor, 'Ответ соответствует цвету букв');
      check(stroop.options!.length === new Set(stroop.options!.map(o => o.id)).size, 'Варианты цвета уникальны');
      if (word !== ink.label) check(stroop.options!.some(o => o.label === word), 'При конфликте смысл слова присутствует как отвлекающий вариант');
      const digits = TASK_BY_ID['digit-span'].make(level, band);
      check(checkTaskAnswer(digits, { digits: digits.digits!.join('') }), 'Цифры проверяются по порядку, включая ноль');
    }
  }
}
console.log('Проверены генерация и ответы задач для трёх возрастов и пяти уровней');
