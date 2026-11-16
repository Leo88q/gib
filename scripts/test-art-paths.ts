/**
 * Проверка путей к графике v2.
 *
 * Ловит три класса ошибок, которые иначе видны только на телефоне:
 *  1. путь ведёт в несуществующий файл (битая картинка на экране);
 *  2. путь выходит за пределы `/art/` или содержит `..` (обход каталога);
 *  3. «файл» — не PNG или заглушка в 200 байт.
 *
 * Плюс смысловая проверка: недели и компетенции показывают **места района**,
 * а не 12 отдельных картинок. Если кто-то вернёт `week-NN.png`, тест скажет.
 */
import fs from 'node:fs';
import { PROGRAM } from '../lib/content/program/index.ts';
import { DEFAULT_ART, heroArt, heroFace, heroById, skillArt, competencyArt, weekArt } from '../lib/art-paths.ts';
import { PLACES, ITEMS, CREATURES, placeArt, itemArt, creatureArt } from '../lib/design/tokens.ts';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function checkImage(assetPath: string) {
  if (!assetPath.startsWith('/art/v2/') || assetPath.includes('..')) throw new Error(`Unsafe asset path: ${assetPath}`);
  const full = `public${assetPath}`;
  if (!fs.existsSync(full)) throw new Error(`Файла нет: ${assetPath}`);
  const bytes = fs.readFileSync(full);
  if (bytes.length < 1024 || !bytes.subarray(0, 8).equals(signature)) throw new Error(`Invalid PNG: ${assetPath}`);
}

/* --- навыки: шесть существ навыков ------------------------------------- */
for (const skill of ['attention', 'working_memory', 'flexibility', 'inhibition', 'planning', 'logic']) {
  checkImage(skillArt(skill));
}
if (skillArt('working_memory') !== creatureArt('memory')) throw new Error('«Память» должна показывать белку-архив, а не отдельную иконку');

/* --- компетенции и недели: места района -------------------------------- */
for (const competence of ['self_awareness', 'self_regulation', 'empathy', 'relationships', 'decision_making', 'creative_thinking', 'growth_mindset']) {
  checkImage(competencyArt(competence));
  if (!competencyArt(competence).includes('/places/')) throw new Error(`Компетенция ${competence} должна показывать место района`);
}
for (const week of PROGRAM) {
  const art = weekArt(week.week, week.competency);
  checkImage(art);
  if (!art.includes('/places/')) throw new Error(`Неделя ${week.week} должна показывать место, а не отдельную сцену`);
}
const weekArts = new Set(PROGRAM.map((w) => weekArt(w.week, w.competency)));
if (weekArts.size > 7) throw new Error(`Мест больше семи: ${weekArts.size}`);
if (weekArts.size < 5) throw new Error(`Места не используются: всего ${weekArts.size} разных сцен на 12 недель`);

/* --- проводники --------------------------------------------------------- */
for (const band of ['5-7', '8-10', '11-13']) checkImage(heroArt(band));
/* Круглые слоты берут крупный портрет: полный рост в 56 px не читается. */
for (const band of ['5-7', '8-10', '11-13']) checkImage(heroFace(band));
if (heroFace('5-7') === heroFace('11-13')) throw new Error('Портреты разных линеек совпадают');
if (heroArt('5-7') === heroArt('11-13')) throw new Error('Разные линейки должны вести разные герои');
for (const hero of ['lis', 'mira', 'tima']) checkImage(heroById(hero));

/* --- неизвестные идентификаторы уходят на безопасный дефолт ------------- */
checkImage(DEFAULT_ART);
if (skillArt('other') !== DEFAULT_ART) throw new Error('Неизвестный навык должен уходить на Лиса');
if (heroById('единорог') !== DEFAULT_ART) throw new Error('Неизвестный герой должен уходить на Лиса');
checkImage(competencyArt('other'));
checkImage(weekArt(0, 'other'));
checkImage(weekArt(99, 'self_awareness'));

/* --- все ассеты контракта существуют и это настоящие PNG ---------------- */
for (const id of CREATURES) checkImage(creatureArt(id));
for (const id of ITEMS) checkImage(itemArt(id));
for (const id of PLACES) checkImage(placeArt(id));
checkImage(placeArt('map'));

console.log(
  `Проверены PNG: ${CREATURES.length} персонажей, ${ITEMS.length} предметов, ${PLACES.length + 1} сцен; `
  + `${weekArts.size} мест закрывают 12 недель программы.`,
);
