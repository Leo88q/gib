export type BlockStep = { type: string; label: string; color: number };
export const BLOCK_STEPS: BlockStep[] = [
  { type: 'gib_pause', label: 'Сделать паузу', color: 210 },
  { type: 'gib_listen', label: 'Выслушать друга', color: 145 },
  { type: 'gib_plan', label: 'Обсудить решение', color: 35 },
];
export const BLOCK_SOLUTION = BLOCK_STEPS.map(step => step.type);
export function checkBlockOrder(order: readonly string[]): boolean {
  return order.length === BLOCK_SOLUTION.length && order.every((step, i) => step === BLOCK_SOLUTION[i]);
}
