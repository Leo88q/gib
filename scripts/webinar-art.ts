/**
 * Уникальные кадры к КАЖДОМУ слайду видео-вебинаров (Alice AI ART).
 *
 * По решению владельца кадры не переиспользуются: один слайд — один свой кадр.
 * Расход: слайдов × кандидатов × 2,23 ₽. Сухой прогон показывает объём и цену,
 * ничего не тратит; --yes генерирует out/webinars/art/<slideId>-c<N>.png
 * (уже готовые пропускаются, --force перегенерирует) и пишет расход в журнал.
 *
 * Постановка кадра собирается из вычитанного текста слайда (только ключевые
 * слова для локации/действия, без пересказа) + ротация камеры/эмоции по индексу
 * слайда, поэтому все 930 кадров разные. Без текста и букв в кадре.
 *
 * Запуск:
 *   npx tsx scripts/webinar-art.ts                        # сухой прогон
 *   npx tsx scripts/webinar-art.ts --audience=parent      # только родительская серия
 *   npx tsx scripts/webinar-art.ts --slug=01 --candidates=2
 *   YANDEX_API_KEY=... npx tsx scripts/webinar-art.ts --yes
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, OUT_DIR,
} from './yandex-api.ts';
import { ART_RATE_RUB_PER_IMAGE, buildPlan, type WebinarAudience, type WebinarSlide } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const onlyAudience = argValue(argv, 'audience') as WebinarAudience | undefined;
const slugFilter = argValue(argv, 'slug');
const candidates = Number(argValue(argv, 'candidates') ?? '1');
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? String(ART_RATE_RUB_PER_IMAGE));
const model = process.env.YANDEX_ART_MODEL ?? `art://${folderId()}/aliceai-image-art-3.0/latest`;
// Вертикаль по умолчанию: под 9:16 почти 1:1, под 16:9 — центральный кроп (см. docs/webinar-video.md).
const size = process.env.YANDEX_ART_SIZE ?? '1024x1792';
const base = process.env.YANDEX_ART_BASE ?? process.env.YANDEX_LLM_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
const artStyle = process.env.YANDEX_ART_STYLE ??
  'Современная стилизованная 3D-анимация (Pixar/DreamWorks): мягкие объёмы, большие выразительные глаза, тёплые персиково-оранжевые тона, мягкий студийный свет';
const artDir = join(OUT_DIR, 'webinars', 'art');

if (onlyAudience && onlyAudience !== 'teacher' && onlyAudience !== 'parent') {
  console.error('--audience: teacher | parent');
  process.exit(1);
}

const LOC_HINTS: [RegExp, string][] = [
  [/крас|мастер|инструмент|самодел|почин|кружок/i, 'мастерская'],
  [/книг|библиотек|читальн/i, 'библиотека'],
  [/рын|покупа|лавк|ярмар/i, 'рынок'],
  [/класс|урок|учитель|школ/i, 'класс'],
  [/ужин|стол|кухн|дом|комнат|вечер/i, 'дом: гостиная'],
  [/чат|сообщени|переписк|телеграм|родител/i, 'дом: родитель за телефоном'],
  [/площадк|качел|горк/i, 'двор: игровая площадка'],
  [/парк|алле/i, 'парк'],
  [/экран|планшет|телефон|приложен/i, 'комната с планшетом на столе'],
];
const EMOTIONS = ['спокойный, добрый', 'заинтересованный, внимательный', 'мягкая улыбка', 'сосредоточенный', 'удивлённый, любопытный'];
const CAMERAS = [
  'общий план, камера вровень, анфас, симметричная композиция',
  'средний план, ракурс три четверти, правило третей',
  'крупный план, лёгкий верхний ракурс',
  'средний общий план, лёгкий нижний ракурс, ведущая линия',
] as const;
// Один кадр — один герой программы; ротация по слайду, чтобы все кадры были разными.
const CAST = [
  'Лис: рыжий лис-механик в спецовке с карманами, большие уши',
  'Мира: девочка с косичкой-«антенной» из трёх резинок, комбинезон, блокнот в руках',
  'Тима: мальчик лет одиннадцати, серо-синее худи, наушники на шее, планшет под мышкой',
] as const;

export function slidePrompt(slide: WebinarSlide, slideIndex: number, audience: WebinarAudience, webinarTitle: string): string {
  const hay = `${slide.title}. ${slide.narration.slice(0, 400)}`;
  const location = LOC_HINTS.find(([re]) => re.test(hay))?.[1] ?? (audience === 'teacher' ? 'класс' : 'дом: гостиная');
  const hero = CAST[slideIndex % CAST.length];
  const camera = CAMERAS[slideIndex % CAMERAS.length];
  const emotion = EMOTIONS[slideIndex % EMOTIONS.length];
  const context = audience === 'teacher'
    ? 'Кадр к вебинару для педагогов программы «Гиб»: учебная ситуация, один герой в кадре.'
    : 'Кадр к вебинару для родителей программы «Гиб»: тёплая сцена про дом и ребёнка, один герой в кадре.';
  return [
    `${artStyle}.`,
    context,
    `Герой: ${hero}.`,
    `Кадр: ${camera}.`,
    `Локация: ${location}.`,
    `О чём кадр (без текста в изображении): тема «${webinarTitle}» — ${slide.title}.`,
    `Эмоция: ${emotion}.`,
    'Без надписей, букв и цифр в кадре; без брендов; без реальных людей; без motion blur; один персонаж, воздух над головой.',
  ].join(' ');
}

const plan = buildPlan(onlyAudience, slugFilter);
const jobs: { slide: WebinarSlide; audience: WebinarAudience; webinarTitle: string; candidate: number; prompt: string; outFile: string }[] = [];
let skipped = 0;
for (const w of plan.webinars) {
  for (const slide of w.slides) {
    for (let candidate = 1; candidate <= candidates; candidate += 1) {
      const outFile = join(artDir, `${slide.id}-c${candidate}.png`);
      if (existsSync(outFile) && !force) { skipped++; continue; }
      jobs.push({ slide, audience: w.audience, webinarTitle: w.title, candidate, prompt: slidePrompt(slide, slide.index, w.audience, w.title), outFile });
    }
  }
}
const totalSlides = plan.webinars.reduce((sum, w) => sum + w.slides.length, 0);
const cost = jobs.length * rate;

console.log('Видео-вебинары — Alice AI ART (кадр на слайд, все разные)');
console.log(`  выпусков: ${plan.webinars.length} | слайдов: ${totalSlides} | кандидатов на слайд: ${candidates}`);
console.log(`  уже готовы (пропущено): ${skipped} | к генерации: ${jobs.length} → ≈ ${cost.toFixed(2)} ₽ (${rate} ₽/изображение, ${model}, ${size})`);
if (jobs[0]) console.log(`\nПример промпта (${jobs[0].slide.id}):\n${jobs[0].prompt}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
  mkdirSync(artDir, { recursive: true });
  const key = apiKey();
  let generated = 0;
  let failed = 0;

  await runPool(jobs, 3, async (job) => {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: job.prompt, n: 1, size }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${job.slide.id}#${job.candidate}): ${(await response.text()).slice(0, 300)}`);
      return;
    }
    const data = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (item?.b64_json) {
      writeFileSync(job.outFile, Buffer.from(item.b64_json, 'base64'));
      generated++;
    } else if (item?.url) {
      const image = await fetch(item.url);
      writeFileSync(job.outFile, Buffer.from(await image.arrayBuffer()));
      generated++;
    } else {
      failed++;
      console.error(`  ! Пустой ответ для ${job.outFile}`);
    }
    if (generated > 0 && generated % 50 === 0) console.log(`  …сгенерировано ${generated} кадров`);
  });

  appendSpend({ tool: 'webinar-art', webinars: plan.webinars.length, slides: totalSlides, candidates, generated, failed, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model, size });
  console.log(`\nГотово: ${generated} кадров в ${artDir}, ошибок ${failed}. Отбор глазами — до сборки видео.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
