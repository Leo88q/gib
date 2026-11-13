/**
 * Стили для методических экранов.
 *
 * Зачем отдельный тест. Классы в JSX не проверяет ни TypeScript, ни сборка:
 * `className="teacher-hint"` без правила в globals.css собирается зелёным и
 * выглядит как обычный текст. Ровно это и случилось с подсказкой педагогу —
 * смысл был, оформления не было, и в браузере подсказка сливалась с
 * посещаемостью.
 *
 * Проверяется:
 *  - каждый класс из методических компонентов описан в globals.css;
 *  - тревожный сигнал отличается от обычной подсказки не только словом;
 *  - подсказка не спрятана целиком под клик, если она про три отказа;
 *  - в оформлении нет «оценок»: классов score/ball/rating не бывает.
 *
 * Запуск: npm run test-method-ui-styles
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Скрипты запускаются из корня репозитория (npm test), поэтому cwd, а не
// import.meta.dirname: в cjs-режиме его нет.
const root = process.cwd();
const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

const screens = ['components/TeacherCabinet.tsx', 'components/LessonCalendar.tsx'];
const used = new Set<string>();

for (const file of screens) {
  const source = readFileSync(join(root, file), 'utf8');

  // className="a b" и className={`a ${x ? 'b' : ''}`} — берём литеральные части.
  const literals = source.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g) ?? [];
  for (const chunk of literals) {
    const body = chunk.replace(/^className=/, '').replace(/^["`]|["`]$/g, '');
    // Выражения внутри шаблона (`${...}`) — не классы, их пропускаем.
    const cleaned = body.replace(/\$\{[^}]*\}/g, ' ');
    for (const token of cleaned.split(/\s+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(token)) used.add(token);
    }
  }
}

assert.ok(used.size > 10, `из компонентов собрано ${used.size} классов — разбор JSX сломался`);

const missing = [...used].filter((name) => !new RegExp(`\\.${name}(?![a-z0-9-])`).test(css));
assert.deepEqual(missing, [], `классы в компонентах без правила в globals.css: ${missing.join(', ')}`);
console.log(`  ok все ${used.size} классов из методических экранов описаны в globals.css`);

/* ---- Тревожный сигнал отличим ---- */

const alertRule = css.match(/\.teacher-hint-alert\s*\{([^}]*)\}/);
assert.ok(alertRule, 'нет отдельного правила для тревожного сигнала: три отказа выглядят как обычная подсказка');
assert.ok(/border-left/.test(alertRule[1]), 'у сигнала нет выделения рамкой: цвет — единственный признак');
assert.ok(/background/.test(alertRule[1]), 'у сигнала нет фона');

const plainRule = css.match(/\.teacher-hint\s*\{([^}]*)\}/);
assert.ok(plainRule, 'нет правила для обычной подсказки');
assert.notEqual(plainRule[1], alertRule[1], 'обычная подсказка и тревога оформлены одинаково');
console.log('  ok тревожный сигнал отличается формой, а не только словом');

/* ---- Три отказа не спрятаны под клик ---- */

const cabinet = readFileSync(join(root, 'components/TeacherCabinet.tsx'), 'utf8');
const alertBlock = cabinet.slice(cabinet.indexOf('teacher-hint teacher-hint-alert'));
assert.ok(alertBlock.length > 0, 'в компоненте нет блока тревожного сигнала');
const beforeAlert = cabinet.slice(0, cabinet.indexOf('teacher-hint-alert'));
const lastOpen = beforeAlert.lastIndexOf('<details');
const lastClose = beforeAlert.lastIndexOf('</details>');
assert.ok(lastClose > lastOpen, 'тревожный сигнал завёрнут в <details>: его нужно открывать, а он нужен сразу');
assert.ok(/refusalsInRow/.test(alertBlock.slice(0, 900)), 'в сигнале нет числа отказов подряд');
console.log('  ok сигнал виден без клика и называет число отказов');

/* ---- Печать планов: на бумаге только планы ---- */

/**
 * Печать — единственный экран, который уходит из приложения физически. Если
 * правило забыть, педагог получает лист с кнопками «Отметить» и раскрытыми
 * подсказками вместо плана встречи.
 */
const printBlock = css.slice(css.indexOf('@media print'));
assert.ok(printBlock.length > 100, 'в globals.css нет правил печати: кнопка «распечатать» печатает кабинет целиком');

for (const hidden of ['.no-print', '.btn', '.teacher-hint', '.teacher-group']) {
  assert.ok(
    new RegExp(`\\${hidden}[^{]*\\{[^}]*display:\\s*none`, 's').test(printBlock),
    `в печати остаётся ${hidden}: на бумагу уйдёт то, что нужно только на экране`,
  );
}
assert.ok(/\.print-only[^{]*\{[^}]*display:\s*block/s.test(printBlock), 'печатная версия планов не показывается при печати');

// План не должен разрываться между страницами: блок из пяти пунктов,
// разрезанный пополам, на бумаге не читается.
assert.ok(/break-inside:\s*avoid/.test(printBlock), 'план встречи может разорваться между страницами');

// На экране печатная версия скрыта, иначе кабинет удлиняется в 12 раз.
assert.ok(
  /\.print-plans[^{]*\{[^}]*display:\s*none/s.test(css.split('@media print')[0]),
  'печатная версия планов видна на экране',
);
console.log('  ok печать: только планы, без кнопок и подсказок, без разрывов');

/* ---- В оформлении нет шкал ---- */

for (const name of ['score', 'ball', 'rating', 'grade', 'level-bar', 'percent']) {
  assert.ok(!new RegExp(`\\.${name}(?![a-z0-9-])`).test(css), `в CSS появился класс оценки: ${name}`);
}
console.log('  ok в оформлении нет оценок и шкал');

console.log('\nСтили методических экранов: каждый класс описан, сигнал отличим, оценок нет.');
