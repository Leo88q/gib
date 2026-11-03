import { bubbleWavePositions, bubbleWaveSize } from '../lib/content/bubble-waves.ts';
function assert(ok: unknown, text: string) { if (!ok) throw new Error(text); }
for (const r of [0, 0.24, 0.5, 0.99]) {
  for (let n = 1; n <= 4; n++) {
    const positions = bubbleWavePositions(n, () => r);
    assert(positions.length === n, 'неверный размер волны');
    assert(new Set(positions).size === n, 'точки не должны повторяться');
    assert(positions.every(pos => pos >= 0 && pos < 6), 'точка вне поля');
  }
  let remaining = 8;
  while (remaining > 0) {
    const size = bubbleWaveSize(remaining, () => r);
    assert(size >= 1 && size <= 4 && size <= remaining, 'неверная следующая волна');
    remaining -= size;
  }
}
for (const invalid of [0, -1, 5]) {
  let threw = false;
  try { bubbleWavePositions(invalid); } catch { threw = true; }
  assert(threw, 'недопустимая волна должна быть отклонена');
}
console.log('Волны пузырьков: размеры, позиции и завершение проверены');
