import type { TaskInstance } from '../content/cognitive.ts';

export type AnswerPayload = { index?: number; cells?: number[]; digits?: string; targets?: number[]; assisted?: boolean; skip?: true };

/** Для поиска отличий порядок не важен; для цепочки памяти — важен. */
export function checkTaskAnswer(instance: TaskInstance, payload: AnswerPayload): boolean {
  const answer = instance.answer;
  if (!answer) return false;
  if (answer.index !== undefined) return payload.index === answer.index;
  if (answer.cells !== undefined) {
    if (!payload.cells || payload.cells.length !== answer.cells.length) return false;
    if (instance.kind === 'order' && answer.before) {
      const selected = payload.cells;
      if (new Set(selected).size !== answer.cells.length || selected.some(i => !Number.isInteger(i) || i < 0 || i >= answer.cells!.length)) return false;
      return answer.before.every(([a, b]) => selected.indexOf(a) < selected.indexOf(b));
    }
    const selected = instance.kind === 'finddiff' ? [...payload.cells].sort((a, b) => a - b) : payload.cells;
    return answer.cells.every((cell, i) => cell === selected[i]);
  }
  if (answer.digits !== undefined) return payload.digits === answer.digits;
  if (answer.targets !== undefined) {
    const selected = [...(payload.targets ?? [])].sort((a, b) => a - b);
    return selected.length === answer.targets.length && answer.targets.every((cell, i) => cell === selected[i]);
  }
  return false;
}
