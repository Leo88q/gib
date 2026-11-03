/**
 * Проверка графики: какие изображения нужны и какие уже на месте.
 * Запуск: npm run check:art
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'public', 'art');

const REQUIRED: { file: string; purpose: string }[] = [
  { file: 'mascot-main.png', purpose: 'маскот на главной' },
  { file: 'mascot-celebrate.png', purpose: 'маскот на экране итогов' },
  { file: 'mascot-think.png', purpose: 'маскот в кабинете родителя' },
  { file: 'hero.png', purpose: 'обложка онбординга' },
  { file: 'support-workshop.png', purpose: 'набор поддержки' },
  { file: 'icon-attention.png', purpose: 'иконка навыка «Внимание»' },
  { file: 'icon-working-memory.png', purpose: 'иконка навыка «Рабочая память»' },
  { file: 'icon-flexibility.png', purpose: 'иконка навыка «Гибкость»' },
  { file: 'icon-inhibition.png', purpose: 'иконка навыка «Торможение»' },
  { file: 'icon-planning.png', purpose: 'иконка навыка «Планирование»' },
  { file: 'icon-logic.png', purpose: 'иконка навыка «Логика»' },
  { file: 'icon-self-awareness.png', purpose: 'иконка компетенции «Самопознание»' },
  { file: 'icon-self-regulation.png', purpose: 'иконка компетенции «Саморегуляция»' },
  { file: 'icon-empathy.png', purpose: 'иконка компетенции «Эмпатия»' },
  { file: 'icon-relationships.png', purpose: 'иконка компетенции «Навыки отношений»' },
  { file: 'icon-decision-making.png', purpose: 'иконка компетенции «Ответственные решения»' },
  { file: 'icon-creative-thinking.png', purpose: 'иконка компетенции «Творческое мышление»' },
  { file: 'icon-growth-mindset.png', purpose: 'иконка компетенции «Мышление роста»' },
  ...Array.from({ length: 12 }, (_, i) => ({
    file: `week-${String(i + 1).padStart(2, '0')}.png`,
    purpose: `иллюстрация недели ${i + 1}`,
  })),
];

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

let missing = 0;
for (const item of REQUIRED) {
  const full = path.join(DIR, item.file);
  let ok = false;
  try {
    const bytes = fs.readFileSync(full);
    const signature = Buffer.from([137,80,78,71,13,10,26,10]);
    ok = bytes.length > 1024 && bytes.subarray(0, 8).equals(signature) && bytes.subarray(12, 16).toString() === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  } catch { /* absent or unreadable */ }
  if (!ok) missing += 1;
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${item.file.padEnd(30)} ${item.purpose}`);
}

console.log(
  missing === 0
    ? `\nВся графика на месте: ${REQUIRED.length} файлов`
    : `\nНе хватает ${missing} из ${REQUIRED.length} файлов (в UI работает запасной вариант)`,
);
if (process.argv.includes('--strict') && missing) process.exitCode = 1;
