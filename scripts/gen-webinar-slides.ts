/**
 * Слайды видео-вебинара (Alice AI ART): полные ART-кадры с текстом внутри.
 *
 * По решению владельца слайды — это ART-кадры (как пилот вебинара), но чистая
 * типографика без персонажей и ~≤40 слов на кадр (точность кириллицы требует
 * минимализма). Единый замороженный стиль-блок «Занавес» для всех 48 выпусков.
 *
 * Слайд-план — JSON рядом с вычитанным вебинаром (content/webinars/.../*.slides.json),
 * чтобы `git pull` на маке давал рабочий пакет целиком. Выход — out/webinars/
 * <slug>/slides/<id>-c<N>.png. Сухой прогон 0 ₽; --yes тратит
 * слайды × кандидатов × rate; `--force` перегенерирует готовые.
 *
 * Запуск:
 *   npx tsx scripts/gen-webinar-slides.ts                          # сухой прогон
 *   npx tsx scripts/gen-webinar-slides.ts --candidates=2
 *   YANDEX_API_KEY=... npx tsx scripts/gen-webinar-slides.ts --yes # на маке владельца
 *
 * YANDEX_ART_SIZE по умолчанию 1792x1024 (≈16:9); другая ширина/высота — через env.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, OUT_DIR,
} from './yandex-api.ts';
import { ART_RATE_RUB_PER_IMAGE } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const planArg = argValue(argv, 'plan') ?? 'content/webinars/parent/01-кто-я-и-что-я-чувствую.slides.json';
const candidates = Number(argValue(argv, 'candidates') ?? '2');
const force = argv.includes('--force');
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const rate = Number(argValue(argv, 'rate') ?? String(ART_RATE_RUB_PER_IMAGE));
const model = process.env.YANDEX_ART_MODEL ?? `art://${folderId()}/aliceai-image-art-3.0/latest`;
const size = process.env.YANDEX_ART_SIZE ?? '1792x1024';
const base = process.env.YANDEX_ART_BASE ?? process.env.YANDEX_LLM_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
// Замороженный стиль-блок «Занавес»: менять только целиком, всем 48 выпускам.
const STYLE_BLOCK =
  'Премиальная печатная афиша: современный стилизованный 3D-рендер (Pixar/DreamWorks), мягкие объёмы; ' +
  'глубокий сливовый театральный занавес с мягкой складкой в верхней части кадра, тёплая кремовая бумага #FDF4E9 как основная плоскость под текст, ' +
  'тонкая латунная линия-разделитель, лёгкое зерно плёнки, мягкая виньетка; ' +
  'композиция 16:9, текст по центру или слева с левым полем; без персонажей, без людей, без брендов, без рамок и иконок; ' +
  'текст — крупный гротеск, идеально читаемый, вся кириллица корректна, ё с точками, кавычки-ёлочки и длинные тире сохранены; ' +
  'на кадре только заявленный текст ниже, никаких других букв, слов или цифр.';

const FAMILY_BLOCK: Record<string, string> = {
  занавес: 'Семейство «занавес»: сливовый фон почти во весь кадр, кремовый текст, широкий воздух сверху.',
  сцена: 'Семейство «сцена»: кремовая бумага на две трети кадра, сливовый текст, латунная линия под заголовком.',
  репетиция: 'Семейство «репетиция»: кремовая бумага, список из пяти строк крупно, тонкая линия под каждой строкой.',
  'стоп-фразы': 'Семейство «стоп-фразы»: кремовая бумага, сливовый текст, в левом верхнем углу маленький латунный штамп-круг с текстом «ВАЖНО».',
  артефакт: 'Семейство «артефакт»: крафтовая карточка на бумаге, тёплый свет, мягкая тень карточки.',
  вопрос: 'Семейство «вопрос»: кремовая бумага, заголовок-цитата во весь кадр крупно, много воздуха, без других объектов.',
};

type Slide = { id: string; family: string; kicker: string; title: string; lines: string[]; footer: string };

const planPath = planArg;
const slides = JSON.parse(readFileSync(planPath, 'utf8')) as Slide[];
const webinar = basename(planPath).replace(/\.slides\.json$/, '');
const artDir = join(OUT_DIR, 'webinars', webinar, 'slides');

function promptFor(slide: Slide): string {
  const family = FAMILY_BLOCK[slide.family] ?? FAMILY_BLOCK['сцена'];
  const textLines = [slide.kicker.toUpperCase(), slide.title, ...slide.lines, slide.footer]
    .map((line) => `«${line.replace(/«|»/g, '"')}»`)
    .join(' / ');
  return [
    STYLE_BLOCK,
    family,
    `Строки текста на кадре (дословно, именно в таком виде, каждая с новой строки, порядок сверху вниз): ${textLines}.`,
    'Текст крупный, контрастный, сливовый на кремовом или кремовый на сливовом — по семейству. Никакого другого текста, цифр, подписей, водяных знаков.',
  ].join('\n');
}

const jobs: { slide: Slide; candidate: number; prompt: string; outFile: string }[] = [];
let skipped = 0;
for (const slide of slides) {
  for (let candidate = 1; candidate <= candidates; candidate += 1) {
    const outFile = join(artDir, `${slide.id}-c${candidate}.png`);
    if (existsSync(outFile) && !force) { skipped += 1; continue; }
    jobs.push({ slide, candidate, prompt: promptFor(slide), outFile });
    if (jobs.length >= limit) break;
  }
  if (jobs.length >= limit) break;
}
const cost = jobs.length * rate;

console.log(`Слайды вебинара — Alice AI ART (${webinar})`);
console.log(`  слайдов: ${slides.length} | кандидатов на слайд: ${candidates}`);
console.log(`  уже готовы (пропущено): ${skipped} | к генерации: ${jobs.length} → ≈ ${cost.toFixed(2)} ₽ (${rate} ₽/изображение, ${model}, ${size})`);
if (jobs[0]) console.log(`\nПример промпта (${jobs[0].slide.id}):\n${jobs[0].prompt}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Боевой запуск на маке: --yes (и YANDEX_API_KEY в окружение).');
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
      failed += 1;
      console.error(`  ! ${response.status} (${job.slide.id}#${job.candidate}): ${(await response.text()).slice(0, 300)}`);
      return;
    }
    const data = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (item?.b64_json) {
      writeFileSync(job.outFile, Buffer.from(item.b64_json, 'base64'));
      generated += 1;
    } else if (item?.url) {
      const image = await fetch(item.url);
      writeFileSync(job.outFile, Buffer.from(await image.arrayBuffer()));
      generated += 1;
    } else {
      failed += 1;
      console.error(`  ! Пустой ответ для ${job.outFile}`);
    }
  });

  appendSpend({ tool: 'webinar-slides', webinar, slides: slides.length, candidates, generated, failed, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model, size });
  console.log(`\nГотово: ${generated} кадров в ${artDir}, ошибок ${failed}. Отбор глазами: текстовая точность важнее красоты.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
