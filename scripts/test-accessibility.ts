/**
 * Доступность: контраст, движение, фокус.
 *
 * Зачем отдельный тест. Контраст невозможно проверить глазами разработчика —
 * на его мониторе всё видно. Провал находится калькулятором, и он находится
 * сразу: ссылки были 2.56:1 при норме 4.5:1, значок упражнения — 2.41:1.
 * Текст, который не читается, — это не «некрасиво», это недоступный продукт,
 * и для детей с особенностями он недоступен вдвойне.
 *
 * Проверяется:
 *  - каждая переменная цвета текста даёт ≥ 4.5:1 на кремовом и белом фоне;
 *  - на цветных подложках текст тёмный, а не цветной в цвет;
 *  - есть правила для «уменьшить движение» и видимого фокуса;
 *  - нет запрета на масштабирование (user-scalable=no) в вёрстке.
 *
 * Запуск: npm run test-accessibility
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

/** Относительная яркость по WCAG 2.x. */
function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Переменные из :root — источник правды для цветов. */
function readVariables(source: string): Map<string, string> {
  const block = source.slice(source.indexOf(':root'), source.indexOf('}', source.indexOf(':root')));
  const found = new Map<string, string>();
  for (const match of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) found.set(match[1], match[2]);
  return found;
}

const vars = readVariables(css);
assert.ok(vars.size > 10, `прочитано ${vars.size} цветовых переменных — разбор :root сломался`);

/* ---- 1. Цвета текста читаются на обоих фонах ---- */

const MIN = 4.5; // обычный текст, WCAG AA
const backgrounds = { cream: vars.get('cream')!, paper: vars.get('paper')! };

for (const name of ['ink', 'ink-soft', 'muted', 'link', 'glyph']) {
  const color = vars.get(name);
  assert.ok(color, `нет переменной --${name}`);
  for (const [bgName, bg] of Object.entries(backgrounds)) {
    const ratio = contrast(color, bg);
    assert.ok(
      ratio >= MIN,
      `--${name} на ${bgName}: ${ratio.toFixed(2)}:1 при норме ${MIN}:1 — текст не читается`,
    );
  }
}
console.log(`  ok цвета текста (ink, ink-soft, muted, link, glyph) ≥ ${MIN}:1 на кремовом и белом`);

/* ---- 2. Цветной текст не ставится на цветной фон ---- */

// Значок был оранжевым на кремовом (2.41:1), ссылка — голубой (2.56:1).
// Проверяем именно это: правило не должно назначать яркий фирменный цвет
// текстом на светлом фоне.
const accentAsText = ['.exercise-window-glyph', '.badge-ping', 'a'];
for (const selector of accentAsText) {
  const index = css.indexOf(`${selector} {`);
  if (index < 0) continue;
  const rule = css.slice(index, css.indexOf('}', index));
  for (const accent of ['--sky', '--orange', '--violet', '--pink', '--mint']) {
    assert.ok(
      !new RegExp(`color:\\s*var\\(${accent}\\)`).test(rule),
      `${selector}: цвет текста ${accent} — контраст к светлому фону ниже нормы`,
    );
  }
}
console.log('  ok яркие фирменные цвета не используются как цвет текста');

/* ---- 3. Текст на цветной кнопке ---- */

// Кнопки: тёмный текст на жёлтом (11.7:1) и белый на цветных. Белый на
// жёлтом был бы 1.44:1 — поэтому проверяем, что жёлтая кнопка не белая.
const btnIndex = css.indexOf('.btn {');
const btnRule = css.slice(btnIndex, css.indexOf('}', btnIndex));
assert.ok(/color:\s*var\(--ink\)/.test(btnRule), 'на жёлтой кнопке не тёмный текст');
const whiteOnYellow = contrast('#ffffff', vars.get('yellow')!);
assert.ok(whiteOnYellow < MIN, 'проверка потеряла смысл: белый на жёлтом внезапно читается');
console.log('  ok кнопки: тёмный текст на ярком фоне, не белый');

/* ---- 4. Движение и фокус ---- */

assert.ok(
  /@media \(prefers-reduced-motion: reduce\)/.test(css),
  'нет правила prefers-reduced-motion: мигающие награды не отключаются',
);
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.ok(/animation-duration:\s*0\.001ms/.test(reduced), 'при «уменьшить движение» анимация не гасится');
assert.ok(/animation-iteration-count:\s*1/.test(reduced), 'при «уменьшить движение» анимация повторяется');

assert.ok(/:focus-visible/.test(css), 'нет видимого фокуса: по кнопкам нельзя ходить табом');
const focusIndex = css.indexOf(':focus-visible');
assert.ok(/outline:/.test(css.slice(focusIndex, css.indexOf('}', focusIndex))), 'фокус без рамки');
console.log('  ok «уменьшить движение» гасит анимацию, у фокуса есть рамка');

/* ---- 5. Масштабирование не запрещено ---- */

const layout = readFileSync(join(root, 'app', 'layout.tsx'), 'utf8');
assert.ok(
  !/user-scalable\s*=\s*['"]no['"]|maximum-scale\s*=\s*['"]1/.test(layout),
  'в вёрстке запрещено масштабирование: тот, кому нужно крупнее, не сможет увеличить',
);
console.log('  ok масштабирование не запрещено');

console.log('\nДоступность: контраст, движение, фокус — проверены расчётом.');
