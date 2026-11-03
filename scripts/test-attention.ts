import { TASK_BY_ID, TASKS, taskForSkill } from '../lib/content/cognitive.ts';
import { checkTaskAnswer } from '../lib/engine/check-answer.ts';
import { taskFeedback } from '../lib/engine/task-feedback.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import type { AgeBand } from '../lib/types.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw Error(message); }
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) for (let level = 1; level <= 5; level++) for (let run = 0; run < 300; run++) {
  const task = TASK_BY_ID['find-match'].make(level, band);
  const size = band === '5-7' ? 3 : 4;
  const target = task.targetCard!;
  check(task.cards?.length === size * size && task.rows === size && task.cols === size, 'размер сетки соответствует возрасту');
  const exact = task.cards!.flatMap((c, i) => c.shape === target.shape && c.color === target.color ? [i] : []);
  check(JSON.stringify(exact) === JSON.stringify(task.answer?.cells), 'ответ содержит все и только совпадения');
  check(exact.length >= 2 && exact.length <= (band === '5-7' ? 3 : 5), 'число целей в допустимом диапазоне');
  check(task.cards!.some(c => c.shape === target.shape && c.color !== target.color), 'есть совпадение только по форме');
  check(task.cards!.some(c => c.shape !== target.shape && c.color === target.color), 'есть совпадение только по цвету');
  check(checkTaskAnswer(task, { cells: [...exact].reverse() }), 'порядок отмеченных фигурок не важен');
  check(!checkTaskAnswer(task, { cells: exact.slice(1) }), 'пропущенная пара неверна');
  check(!checkTaskAnswer(task, { cells: [...exact.slice(0, -1), exact[0]] }), 'повторный индекс неверен');
  check(taskFeedback(task, false, false).includes('Фигурки как образец'), 'разбор описывает пары, а не отличия');

  const diff = TASK_BY_ID['find-diff'].make(level, band);
  const frequencies = new Map<string, number>();
  for (const card of diff.cards!) { const key = `${card.shape}/${card.color}`; frequencies.set(key, (frequencies.get(key) ?? 0) + 1); }
  const base = [...frequencies].sort((a, b) => b[1] - a[1])[0][0];
  const odd = diff.cards!.flatMap((card, i) => `${card.shape}/${card.color}` !== base ? [i] : []);
  check(JSON.stringify(odd) === JSON.stringify(diff.answer?.cells), 'отличия от большинства однозначны');
}
let matchDays = 0, diffDays = 0;
for (let dayIndex = 0; dayIndex < PROGRAM_DAYS.length; dayIndex++) {
  const { day } = PROGRAM_DAYS[dayIndex];
  if (day.skills.includes('attention')) {
    if (taskForSkill('attention', dayIndex).id === 'find-match') matchDays++;
    else diffDays++;
  }
  if (day.day === 5 && day.skills.includes(day.focus) && TASKS.filter(t => t.skill === day.focus).length > 1) {
    check(taskForSkill(day.focus, dayIndex).id !== taskForSkill(day.focus, dayIndex + 1).id, 'босс не повторяет тип задания с тем же навыком');
  }
}
check(matchDays > 0 && diffDays > 0, 'оба вида внимания встречаются в программе');
console.log(`Внимание: 4500 генераций каждого вида, совместимость проверки, ${matchDays} дней с парами и ${diffDays} дней с отличиями`);
