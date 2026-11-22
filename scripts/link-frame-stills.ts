/**
 * Расстановка кадров из каталога в кино-пайплайн: data/frame-catalog.json →
 * out/cinema/_stills/<scene>-<band>.png (файлы для render-cinema.ts).
 *
 * Один и тот же кадр копируется в _stills всем сценам, где он назначен
 * (used_by) — ничего не генерируется и не рисуется заново.
 *
 *   dry-run:  npx tsx scripts/link-frame-stills.ts [--candidate=1]
 *   применить: npx tsx scripts/link-frame-stills.ts --yes [--candidate=1] [--force]
 *   превью 0 ₽: npx tsx scripts/link-frame-stills.ts --yes --placeholder
 *                (отсутствующие кадры заменяются committed-артом мест v2 — ТОЛЬКО тест кино-пайплайна)
 *
 * Приоритет источника: public/art/frames/<key>.png (отобрано вами) →
 * out/art/frames/<key>-c<N>.png (N из --candidate). Существующие _stills
 * не перезаписываются без --force.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractUtterances, readInk, walkInk } from './yandex-api.ts';
import { deriveStage, heroFrameKey, loadShotlist } from './frame-stage.ts';

const argv = process.argv.slice(2);
const yes = argv.includes('--yes');
const force = argv.includes('--force');
const candidate = Number(argv[argv.findIndex((a) => a.startsWith('--candidate='))]?.split('=')[1] ?? '1') || 1;
const placeholder = argv.includes('--placeholder'); // подставить committed-арт мест вместо отсутствующих кадров
const stillsDir = join('out', 'cinema', '_stills');
const CATALOG = join('data', 'frame-catalog.json');
const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(\d+-\d+)\.ink$/;

// Временные превью из committed-арта (public/art/v2/places) для теста кино-цепочки за 0 ₽.
const PLACEHOLDER_PLACE: Record<string, string> = {
  'дом': 'home', 'комната': 'home', 'класс': 'home', 'карта района': 'map',
  'двор': 'yard', 'площадка': 'playground', 'парк': 'playground',
  'библиотека': 'library', 'рынок': 'market', 'теплица': 'greenhouse', 'мастерская': 'workshop',
};
const placeholderFor = (location: string): string | null => {
  const slug = PLACEHOLDER_PLACE[location];
  if (!slug) return null;
  const file = join('public', 'art', 'v2', 'places', `${slug}.png`);
  return existsSync(file) ? file : null;
};


if (!existsSync(CATALOG)) {
  console.error(`Нет ${CATALOG}. Сначала: npm run build:frames`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as {
  frames: Record<string, { path: string; used_by: string[]; disabled?: boolean; needs_review: boolean }>;
};
const shotlist = loadShotlist();

// уникальные сцены (dedup basename, как в build-frame-catalog.ts)
const scenes = new Map<string, { scene: string; band: string; text: string }[]>();
for (const file of walkInk()) {
  const match = AGE_BAND.exec(basename(file));
  if (!match) continue;
  const [, scene, band] = match;
  const list = scenes.get(scene) ?? [];
  list.push({ scene, band, text: extractUtterances(readInk(file)).join(' ') });
  scenes.set(scene, list);
}

type Job = { scene: string; band: string; key: string; src: string; dest: string; review: boolean };
const jobs: Job[] = [];
const missing = new Map<string, number>();
let skippedExisting = 0;
for (const [scene, list] of scenes) {
  const stage = deriveStage(scene, list.sort((a, b) => a.text.length - b.text.length)[0].text, shotlist);
  const seenPairs = new Set<string>(); // deep/ и week-one/ — одни и те же файлы, копируем один раз
  for (const { band } of list) {
    const pair = `${scene}/${band}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const key = heroFrameKey(scene, band, stage);
    const entry = catalog.frames[key];
    const candidates = [
      join('public', 'art', 'frames', `${key}.png`),
      join('out', 'art', 'frames', `${key}-c${candidate}.png`),
    ];
    const src = candidates.find((p) => existsSync(p));
    const dest = join(stillsDir, `${scene}-${band}.png`);
    if (existsSync(dest) && !force) { skippedExisting++; continue; }
    if (!entry || entry.disabled || !src) {
      if (placeholder) {
        // stage у нас один на сцену — берём локацию из того же деривач-паса
        const ph = placeholderFor(stage.location);
        if (ph) { jobs.push({ scene, band, key, src: ph, dest, review: true }); continue; }
      }
      missing.set(key, (missing.get(key) ?? 0) + 1);
      continue;
    }
    jobs.push({ scene, band, key, src, dest, review: entry.needs_review });
  }
}

console.log('Кадры каталога → out/cinema/_stills');
console.log(`  к копированию: ${jobs.length}; пропущено (уже есть): ${skippedExisting}; без файла: ${[...missing.values()].reduce((a, b) => a + b, 0)}`);
if (missing.size > 0) {
  console.log('  нет исходника (сначала сгенерируйте и отберите):');
  for (const [key, count] of [...missing].sort()) console.log(`    ${key} — ${count} сцен`);
}
if (jobs.length > 0) {
  const byKey = new Map<string, number>();
  for (const job of jobs) byKey.set(job.key, (byKey.get(job.key) ?? 0) + 1);
  console.log('  самые используемые:', [...byKey].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join(', '));
}
if (!yes) {
  console.log('\nЭто был сухой прогон. Применить: добавьте --yes.');
  process.exit(0);
}
mkdirSync(stillsDir, { recursive: true });
for (const job of jobs) copyFileSync(job.src, job.dest);
const placeholderCount = jobs.filter((j) => j.src.startsWith(join('public', 'art', 'v2', 'places'))).length;
if (placeholderCount > 0) {
  console.log(`  ВНИМАНИЕ: ${placeholderCount} кадров — ВРЕМЕННЫЕ превью из public/art/v2/places (без героев).`);
  console.log('  Это только проверка кино-цепочки (голос + Ken Burns + выборы). Боевой шаг: сгенерируйте кадры каталога');
  console.log('  (npm run art:frames -- --yes), отберите глазами в public/art/frames/ и перекопируйте без --placeholder.');
}
console.log(`\nСкопировано ${jobs.length} кадров в ${stillsDir}. Дальше: npx tsx scripts/render-cinema.ts`);
if (jobs.length === 0) {
  console.log('\nКадров нет. Минимальный путь: npm run art:frames → глазами просмотрите out/art/frames →');
  console.log('отобранное скопируйте в public/art/frames/ → npx tsx scripts/link-frame-stills.ts --yes → npx tsx scripts/render-cinema.ts');
  console.log('Для мгновенного превью без трат: npx tsx scripts/link-frame-stills.ts --yes --placeholder');
}
