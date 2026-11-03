/** Pure helpers: selections are ordered indexes into the original card list. */
export function toggleSelection(selection: number[], index: number): number[] {
  return selection.includes(index) ? selection.filter(value => value !== index) : [...selection, index];
}
export function moveSelection(selection: number[], position: number, direction: -1 | 1): number[] {
  const next = position + direction;
  if (!Number.isInteger(position) || position < 0 || position >= selection.length || next < 0 || next >= selection.length) return selection;
  const result = [...selection];
  [result[position], result[next]] = [result[next], result[position]];
  return result;
}
