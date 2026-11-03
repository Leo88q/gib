import { TASK_BY_ID, taskForSkill } from '../lib/content/cognitive.ts';
import { checkTaskAnswer } from '../lib/engine/check-answer.ts';
import { taskFeedback } from '../lib/engine/task-feedback.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import type { AgeBand } from '../lib/types.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw Error(message); }
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) for (let level = 1; level <= 6; level++) for (let i = 0; i < 200; i++) {
  const task = TASK_BY_ID['symbol-memory'].make(level, band);
  const max = band === '5-7' ? 3 : band === '8-10' ? 4 : 5;
  check(task.cards?.length === 6 && task.rows === 2 && task.cols === 3, 'шесть значков');
  check(new Set(task.cards!.map(c => c.shape)).size === 6, 'значки имеют различную форму');
  check(task.cells?.length === Math.min(Math.max(2, level + 1), max), 'возрастное ограничение длины');
  check(new Set(task.cells).size === task.cells!.length && task.cells!.every(n => n >= 0 && n < 6), 'шаги уникальны и в пределах сетки');
  check(checkTaskAnswer(task, { cells: task.cells }), 'последовательность принимается');
  check(!checkTaskAnswer(task, { cells: [...task.cells!].reverse() }), 'неверный порядок отклонён');
  check(taskFeedback(task, false, false).includes('Последовательность значков'), 'разбор называет значки');
}
const days = PROGRAM_DAYS.filter(({ day }, i) => day.skills.includes('working_memory') && taskForSkill('working_memory', i).id === 'symbol-memory').length;
check(days > 0, 'упражнение включено в программу');
console.log(`Память: 3600 генераций для всех возрастов; ${days} дней с новыми значками`);
