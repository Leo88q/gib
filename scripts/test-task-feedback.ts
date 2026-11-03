import { taskFeedback } from '../lib/engine/task-feedback.ts';
import { TASKS } from '../lib/content/cognitive.ts';
function check(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
for (const task of TASKS) {
  const instance = task.make(2, '8-10');
  const feedback = taskFeedback(instance, false, false);
  check(feedback.includes('разберём') && feedback.length > 35, `${task.id}: нужен разбор ответа`);
  check(!feedback.includes('undefined'), `${task.id}: нет пропущенных полей`);
  check(taskFeedback(instance, true, true).includes('сложность навыка не меняется'), `${task.id}: практика помечена`);
}
console.log('Разбор ответа и маркировка практики проверены для всех типов задач');
