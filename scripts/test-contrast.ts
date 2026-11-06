import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Контраст основных пар из app/globals.css по WCAG 2.1.
 * Проверяются только пары, где текст реально лежит на этом фоне; порог 4.5:1 (AA, обычный текст).
 * Это статическая проверка файла стилей, а не измерение отрендеренной страницы:
 * тени, градиенты и изображения в расчёт не входят.
 */
const css = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(match, `токен --${name} объявлен`);
  return match[1] as string;
};
function luminance(hex: string) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* 1. Текст на бумаге и на кремовом фоне. */
for (const [fg, bg] of [
  [token('ink'), token('paper')],
  [token('ink'), token('cream')],
  [token('ink-soft'), token('paper')],
  [token('ink-soft'), token('cream')],
  [token('muted'), token('paper')],
  [token('muted'), token('cream')],
]) {
  assert.ok(contrast(fg, bg) >= 4.5, `${fg} на ${bg}: ${contrast(fg, bg).toFixed(2)}`);
}

/* 2. Статусные числа в кабинете: раньше «--ok» и «--bad» давали 3.4 и 4.0. */
const deltaUp = /\.delta\.up\s*{[^}]*color:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
const deltaDown = /\.delta\.down\s*{[^}]*color:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
assert.ok(deltaUp && contrast(deltaUp, '#ffffff') >= 4.5, 'рост читается на белом');
assert.ok(deltaDown && contrast(deltaDown, '#ffffff') >= 4.5, 'снижение читается на белом');

/* 3. Чипы с белым текстом: оранжевый с белым (<3:1) больше не используется. */
const combo = /\.chip\.combo\s*{[^}]*background:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
assert.ok(combo && contrast(combo, '#ffffff') >= 4.5, `чип комбо: ${combo && contrast(combo, '#ffffff').toFixed(2)}`);
assert.ok(!/\.chip\.combo\s*{[^}]*background:\s*var\(--orange\)/.test(css), 'чип комбо не использует светлый оранжевый');
assert.ok(!/--orange:\s*#ff7a3d/.test(css) || !/\.age-btn\.active\s*{[^}]*var\(--orange\)/.test(css), 'выбранный возраст не белый на оранжевом');

/* 4. Ошибка запроса и рамка фокуса остаются заметными. */
const errorText = /\.request-error\s*{[^}]*color:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
const errorBg = /\.request-error\s*{[^}]*background:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
assert.ok(errorText && errorBg && contrast(errorText, errorBg) >= 4.5, 'текст ошибки читается на её фоне');
assert.ok(css.includes('outline: 3px solid #1264c4'), 'фокус виден и не только цветом рамки кнопки');

/* 5. Уменьшение движения и крупный шрифт остаются в сборке. */
assert.ok(css.includes('data-reduce-motion'), 'есть статическая тема без анимации');
assert.ok(/\.large-text|data-large-text/.test(css), 'есть крупный текст');

console.log('  ok контраст: основной текст, статусы и чипы ≥ 4.5:1, фокус виден, крупный текст и уменьшение движения на месте');
