/**
 * Генерация кадров ПО КАТАЛОГУ, а не по сценам (экономия владельца).
 *
 * Кадры: data/frame-catalog.json → out/art/frames/<key>-c<N>.png. Один и тот же
 * кадр используется во всех сценах с той же постановкой (used_by) — ничего не
 * генерируется «отдельно для каждого урока».
 *
 *   dry-run:  npx tsx scripts/yandex-art-frames.ts [--band=8-10] [--only=hero|location] [--candidates=2]
 *   боевой:   YANDEX_API_KEY=... npx tsx scripts/yandex-art-frames.ts --yes [--band=8-10] [--candidates=2] [--force]
 *
 * Перед генерацией лучше прогнать art-stage (≈25 ₽) и пересобрать каталог
 * (npm run build:frames) — эмоции/локации будут точными, а не «спокойный, добрый».
 * Уже сгенерированные файлы пропускаются; --force перегенерирует.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const bandFilter = argValue(argv, 'band'); // 5-7 | 8-10 | 11-13 — только линейка (hero-кадры)
const onlyKind = argValue(argv, 'only'); // hero | location
const candidates = Number(argValue(argv, 'candidates') ?? '2');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? '2.23');
const model = process.env.YANDEX_ART_MODEL ?? `art://${folderId()}/aliceai-image-art-3.0/latest`;
const size = process.env.YANDEX_ART_SIZE ?? '1024x1024';
const base = process.env.YANDEX_ART_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
const artDir = join(OUT_DIR, 'art', 'frames');
const CATALOG = join('data', 'frame-catalog.json');

const ART_STYLE = process.env.YANDEX_ART_STYLE ??
  'Современная стилизованная 3D-анимация (Pixar/DreamWorks): мягкие объёмы, большие выразительные глаза, тёплые персиково-оранжевые тона, мягкий студийный свет';
const HERO_LINE: Record<string, string> = {
  lis: 'Главный герой кадра — Лис: рыжий лис-«механик» в спецовке с карманами, большие уши (левое обвисшее), любопытный, не сдаётся.',
  mira: 'Главная героиня кадра — Мира: девочка с косичкой-«антенной» из трёх резинок, комбинезон, рюкзак, блокнот при себе, замечает детали, не торопится.',
  tima: 'Главный герой кадра — Тима: мальчик лет одиннадцати-тринадцати, в серо-синем худи, наушники на шее, планшет под мышкой, креативен, прячет доброту под «ок».',
};
const VARIANTS = [
  'общий план, камера вровень, анфас, симметричная композиция',
  'средний план, ракурс три четверти, правило третей',
  'крупный план, лёгкий верхний ракурс, правило третей',
  'общий план, лёгкий нижний ракурс, ведущая линия',
] as const;
const HERO_CONSTRAINT =
  'Композиция для вертикального Reels: один герой в кадре, герой по центру по вертикали с воздухом над головой и под ногами, конечности не перекрыты, поза с потенциалом движения, без motion blur, без текста и букв, без брендов и реальных людей.';
const LOC_CONSTRAINT =
  'Пустая локация без людей и животных, вертикальная композиция 9:16, мягкая перспектива, без текста и букв, без брендов.';

type FrameEntry = {
  kind: 'hero' | 'location'; hero?: string; band?: string; location: string;
  emotion?: string; path: string; used_by: string[]; source: string;
  needs_review: boolean; disabled?: boolean;
};

if (!existsSync(CATALOG)) {
  console.error(`Нет ${CATALOG}. Сначала соберите каталог: npm run build:frames`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8')) as { frames: Record<string, FrameEntry> };
let entries = Object.entries(catalog.frames)
  .filter(([, f]) => !f.disabled)
  .filter(([, f]) => !onlyKind || f.kind === onlyKind)
  .filter(([, f]) => !bandFilter || f.kind === 'location' || f.band === bandFilter);

const total = entries.length * candidates;
const cost = total * rate;
console.log('Alice AI ART — кадры по каталогу (не по сценам)');
console.log(`  кадров в каталоге: ${entries.length} (hero ${entries.filter(([, f]) => f.kind === 'hero').length} + loc ${entries.filter(([, f]) => f.kind === 'location').length})${bandFilter ? `, линейка ${bandFilter}` : ''}`);
console.log(`  needs_review в выборке: ${entries.filter(([, f]) => f.needs_review).length}`);
console.log(`  кандидатов на кадр: ${candidates} → генераций: ${total} ≈ ${cost.toFixed(2)} ₽`);
if (entries[0]) {
  const [key, first] = entries[0];
  const prompt = first.kind === 'hero'
    ? `${ART_STYLE}. ${HERO_LINE[first.hero ?? 'lis']} Кадр: ${VARIANTS[0]}. Локация: ${first.location}. Эмоция: ${first.emotion ?? 'спокойный, добрый'}. ${HERO_CONSTRAINT}`
    : `${ART_STYLE}. Локация: ${first.location}. ${LOC_CONSTRAINT}`;
  console.log(`\nПример промпта (${key}):\n${prompt}`);
}
if (!yes) {
  console.log('\nЭто был сухой прогон. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
  mkdirSync(artDir, { recursive: true });
  const key = apiKey();
  const jobs: { key: string; candidate: number; prompt: string }[] = [];
  let skipped = 0;
  for (const [frameKey, f] of entries) {
    for (let c = 1; c <= candidates; c++) {
      const outFile = join(artDir, `${frameKey}-c${c}.png`);
      if (existsSync(outFile) && !force) { skipped++; continue; }
      const variant = VARIANTS[(c - 1) % VARIANTS.length];
      const prompt = f.kind === 'hero'
        ? `${ART_STYLE}. ${HERO_LINE[f.hero ?? 'lis']} Кадр: ${variant}. Локация: ${f.location}. Эмоция: ${f.emotion ?? 'спокойный, добрый'}. ${HERO_CONSTRAINT}`
        : `${ART_STYLE}. Локация: ${f.location}. ${LOC_CONSTRAINT}`;
      jobs.push({ key: frameKey, candidate: c, prompt });
    }
  }
  if (skipped > 0) console.log(`  пропущено уже готовых: ${skipped} (--force — перегенерировать)`);
  let generated = 0, failed = 0;
  await runPool(jobs, 3, async (job) => {
    const outFile = join(artDir, `${job.key}-c${job.candidate}.png`);
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: job.prompt, n: 1, size }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${job.key}#${job.candidate}): ${(await response.text()).slice(0, 200)}`);
      return;
    }
    const data = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (item?.b64_json) { writeFileSync(outFile, Buffer.from(item.b64_json, 'base64')); generated++; }
    else if (item?.url) { const r = await fetch(item.url); writeFileSync(outFile, Buffer.from(await r.arrayBuffer())); generated++; }
    else { failed++; console.error(`  ! Пустой ответ для ${outFile}`); }
    if (generated % 25 === 0 && generated > 0) console.log(`  …сгенерировано ${generated}`);
  });
  appendSpend({ tool: 'alice-ai-art-frames', frames: entries.length, candidates, generated, failed, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model });
  console.log(`\nГотово: ${generated} изображений в ${artDir}, ошибок ${failed}, пропущено ${skipped}.`);
  console.log('Дальше: просмотр → отобранное копируйте в public/art/frames/<key>.png (путь из каталога), затем npm run stills:link');
  if (failed > 0) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
