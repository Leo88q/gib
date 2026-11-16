/**
 * Проверка графики: какие изображения нужны и какие уже на месте.
 * Запуск: npm run check:art
 *
 * Проверяется партия `v2` («мягкий объём»): проводники, существа навыков,
 * предметы и места района. Старые 30 PNG в `public/art` остаются до конца
 * переноса экранов — их никто не удаляет, но новыми они уже не считаются.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'public', 'art');

const creatures = [
  ['lis', 'проводник 5–7'],
  ['mira', 'проводник 8–10'],
  ['tima', 'проводник 11–13'],
  ['attention', 'существо навыка «Внимание»'],
  ['memory', 'существо навыка «Память»'],
  ['flexibility', 'существо навыка «Гибкость»'],
  ['inhibition', 'существо навыка «Торможение»'],
  ['planning', 'существо навыка «Планирование»'],
  ['logic', 'существо навыка «Логика»'],
  ['lis-face', 'портрет Лиса для круглых слотов'],
  ['mira-face', 'портрет Миры для круглых слотов'],
  ['tima-face', 'портрет Тимы для круглых слотов'],
  ['pet', 'личный питомец'],
] as const;

const items = [
  ['cap', 'кепка'], ['bandana', 'бандана'], ['glasses', 'очки'], ['headphones', 'наушники'],
  ['crown', 'корона'], ['scarf', 'шарф'], ['backpack', 'рюкзак'], ['vest', 'жилет'],
  ['super', 'суперкостюм'], ['rug', 'ковёр'], ['lamp', 'лампа'], ['poster', 'плакат'],
  ['plant', 'растение'], ['block', 'блок'], ['bubble', 'пузырь'], ['shapes', 'фигуры'],
  ['cards', 'пара карточек'], ['hourglass', 'песочные часы'], ['notebook', 'блокнот'],
] as const;

const places = [
  ['home', 'дом'], ['yard', 'двор'], ['library', 'библиотека'], ['playground', 'площадка'],
  ['market', 'рынок'], ['greenhouse', 'теплица'], ['workshop', 'мастерская'], ['map', 'карта района'],
] as const;

const REQUIRED: { file: string; purpose: string }[] = [
  ...creatures.map(([id, purpose]) => ({ file: `v2/creatures/${id}.png`, purpose })),
  ...items.map(([id, purpose]) => ({ file: `v2/items/${id}.png`, purpose: `предмет: ${purpose}` })),
  ...places.map(([id, purpose]) => ({ file: `v2/places/${id}.png`, purpose: `место: ${purpose}` })),
];

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

let missing = 0;
for (const item of REQUIRED) {
  const full = path.join(DIR, item.file);
  let ok = false;
  try {
    const bytes = fs.readFileSync(full);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
