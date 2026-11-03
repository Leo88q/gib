import type { TaskInstance } from '../content/cognitive.ts';
import { cardName, colorName, positionName } from '../content/visual-labels.ts';

/** Explanations are generated server-side and sent only after an answer. */
export function taskFeedback(task: TaskInstance, correct: boolean, assisted: boolean): string {
  const prefix = correct ? 'Верно!' : 'Ничего страшного, разберём вместе.';
  const answer = task.answer;
  let explanation = '';
  if (task.kind === 'choice' && answer?.index !== undefined) {
    const label = task.options?.[answer.index]?.label;
    if (label) {
      const board = task.logicBoard;
      if (board?.mode === 'add') explanation = `${board.values[0]} + ${board.values[1]} = ${label}.`;
      else if (board?.mode === 'subtract') explanation = `${board.values[0]} − ${board.values[1]} = ${label}.`;
      else if (board?.mode === 'sequence') explanation = `Ряд: ${board.values.join(' → ')} → ${label}.`;
      else if (board?.mode === 'compare') explanation = `Самое большое число — ${label}.`;
      else explanation = task.taskId === 'stroop' ? `Цвет букв — ${label}.` : `Ответ: ${label}.`;
    }
  } else if (task.kind === 'cards' && answer?.index !== undefined) {
    const card = task.cards?.[answer.index];
    if (card) explanation = `${task.ruleLabel ? `${task.ruleLabel}: ` : 'Подходящая карточка: '}${cardName(card.shape, card.color)}.`;
  } else if (task.kind === 'switch-rounds' && answer?.cells && task.cards && task.rules) {
    explanation = task.rules.map((rule, i) => {
      const card = task.cards![answer.cells![i]];
      return `${rule === 'shape' ? 'По форме' : 'По цвету'}: ${cardName(card.shape, card.color)}`;
    }).join('; ') + '.';
  } else if (task.kind === 'order' && answer?.cells && task.steps) {
    explanation = `Один подходящий порядок: ${answer.cells.map(i => task.steps![i]).join(' → ')}.`;
  } else if (task.kind === 'symbol-memory' && answer?.cells && task.cards) {
    explanation = `Последовательность значков: ${answer.cells.map(i => cardName(task.cards![i].shape, task.cards![i].color)).join(' → ')}.`;
  } else if ((task.kind === 'memory' || task.kind === 'finddiff') && answer?.cells) {
    explanation = `${task.kind === 'memory' ? 'Последовательность' : task.taskId === 'find-match' ? 'Фигурки как образец' : 'Отличающиеся фигурки'}: ${answer.cells.map(i => positionName(i, task.cols ?? 3)).join(' → ')}.`;
  } else if (task.kind === 'digits' && answer?.digits !== undefined) {
    explanation = `Последовательность: ${answer.digits.split('').join(' → ')}.`;
  } else if (task.kind === 'gonogo' && answer?.targets) {
    explanation = `Зелёные сигналы: ${answer.targets.map(i => `${i + 1} (${colorName(task.grid?.[i]?.color ?? 'green')})`).join(', ')}.`;
  }
  const practice = assisted ? ' Это практика с помощью: сложность навыка не меняется.' : '';
  return [prefix, explanation].filter(Boolean).join(' ') + practice;
}
