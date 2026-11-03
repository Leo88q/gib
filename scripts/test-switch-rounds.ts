import { TASK_BY_ID, taskForSkill, type TaskInstance } from '../lib/content/cognitive.ts';
import { checkTaskAnswer } from '../lib/engine/check-answer.ts';
import { taskFeedback } from '../lib/engine/task-feedback.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import type { AgeBand } from '../lib/types.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw Error(message); }
for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) for (let level = 1; level <= 5; level++) for (let run = 0; run < 300; run++) {
  const task = TASK_BY_ID['switch-rounds'].make(level, band);
  check(task.kind === 'switch-rounds' && task.cards?.length === 4, 'четыре карточки');
  const rules = task.rules!;
  check(rules.length === (band !== '5-7' && level >= 3 ? 3 : 2), 'число раундов соответствует возрасту и уровню');
  check(rules.every((r, i) => i === 0 || r !== rules[i - 1]), 'правила чередуются');
  const shapes = task.cards!.map(c => c.shape), colors = task.cards!.map(c => c.color);
  const oddShape = shapes.findIndex(s => shapes.filter(v => v === s).length === 1);
  const oddColor = colors.findIndex(s => colors.filter(v => v === s).length === 1);
  check(oddShape >= 0 && oddColor >= 0 && oddShape !== oddColor, 'правила дают разные карточки');
  const expected = rules.map(r => r === 'shape' ? oddShape : oddColor);
  check(JSON.stringify(task.answer?.cells) === JSON.stringify(expected), 'правила и правильные ответы согласованы');
  check(checkTaskAnswer(task, { cells: expected }), 'верные ответы всех раундов принимаются');
  for (let i = 0; i < expected.length; i++) {
    const wrong = [...expected]; wrong[i] = (wrong[i] + 1) % 4;
    check(!checkTaskAnswer(task, { cells: wrong }), 'ошибка в любом раунде не принимается');
  }
  if (rules.length === 3) check(expected[0] === expected[2], 'один и тот же ответ в разных раундах допустим');
  check(taskFeedback(task, false, false).includes('По форме') && taskFeedback(task, false, false).includes('По цвету'), 'разбор содержит оба правила');
}
const legacy = { kind: 'cards', answer: { index: 2 } } as TaskInstance;
check(checkTaskAnswer(legacy, { index: 2 }) && !checkTaskAnswer(legacy, { index: 1 }), 'старые сохранённые задания сохраняют проверку');
const days = PROGRAM_DAYS.filter(({ day }, i) => day.skills.includes('flexibility') && taskForSkill('flexibility', i).id === 'switch-rounds').length;
check(days > 0, 'упражнение подключено к программе');
console.log(`Переключение: 4500 генераций, разные правила, возрастные раунды; ${days} дней программы`);
