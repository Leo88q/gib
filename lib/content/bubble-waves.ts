/**
 * Адаптация выбора групп точек из Tilli Godot-Strategies-V1,
 * BubblePop/BubbleSpawner.gd, commit a19e449491eb8b4cdb50655d5a5b35b3323a9642.
 * Оригинальные уведомления сохранены в public/licenses/tilli-godot-*.txt.
 * В отличие от оригинала, новая волна появляется только после завершения
 * предыдущей: нет лимита времени и пузырьки не исчезают до нажатия.
 */
export function bubbleWavePositions(count: number, random: () => number = Math.random): number[] {
  const choose = (first: number, length: number) => first + Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
  if (count === 1) return [choose(0, 6)];
  if (count === 2) return [choose(0, 3), choose(3, 3)];
  if (count === 3) return [choose(0, 2), choose(2, 2), choose(4, 2)];
  if (count === 4) return [0, choose(1, 2), choose(3, 2), 5];
  throw new RangeError('A wave must contain 1 to 4 bubbles');
}

export function bubbleWaveSize(remaining: number, random: () => number = Math.random): number {
  if (!Number.isInteger(remaining) || remaining < 1) throw new RangeError('A wave needs at least one bubble');
  if (remaining === 1) return 1;
  return Math.min(remaining, 2 + Math.min(2, Math.max(0, Math.floor(random() * 3))));
}
