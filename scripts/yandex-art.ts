/**
 * Черновая отрисовка сцен недели/всей программы через Alice AI ART (OpenAI-совместимый Images API).
 *
 * Зачем: заменить в продукте «белые слайды» на иллюстрации сцен — самая заметная
 * вещь для презентации Яндексу и родителям. Гранта хватает с запасом:
 * 452 сцены × 4 кандидата ≈ 1 800 генераций ≈ 4 000 ₽ по тарифу 2,23 ₽.
 *
 * Чего скрипт НЕ делает: не выбирает лучший кадр (это делает человек глазами),
 * не коммитит результат (весь выход — в git-ignored out/art), не гарантирует
 * согласованность лица персонажа (для пилота — фиксируем стиль промптом и
 * сравниваем; дообучение под изображения в API недоступно).
 *
 * Запуск:
 *   npx tsx scripts/yandex-art.ts                  # сухой прогон: объём и цена
 *   npx tsx scripts/yandex-art.ts --only=w1        # только неделя 1 (15 сцен × 3 возраста)
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-art.ts --yes --only=w1 --candidates=4
 *
 * Если Images API отвечает ошибкой, сверьте точный model-URI в карточке модели
 * (AI Studio → Model Gallery → Alice AI ART → «Код») и передайте его через
 * YANDEX_ART_MODEL; базовый адрес можно сменить через YANDEX_ART_BASE.
 * (Проверено на каталоге пользователя 21.11.2026:
 *  model = art://<folder>/aliceai-image-art-3.0/latest,
 *  base  = https://ai.api.cloud.yandex.net/v1.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  apiKey, appendSpend, argValue, extractUtterances, folderId, hasYesFlag,
  readInk, runPool, walkInk, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only'); // например, w1
const bandFilter = argValue(argv, 'band'); // например, 8-10 — только эта линейка
const candidates = Number(argValue(argv, 'candidates') ?? '4');
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const rate = Number(argValue(argv, 'rate') ?? '2.23'); // ₽ за изображение
const model = process.env.YANDEX_ART_MODEL ?? `art://${folderId()}/aliceai-image-art-3.0/latest`;
const size = process.env.YANDEX_ART_SIZE ?? '1024x1024';
const base = process.env.YANDEX_ART_BASE ?? process.env.YANDEX_LLM_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
// Арт-дирекция проекта: современный стилизованный 3D («как в Pixar / DreamWorks»),
// а не акварельная книжная иллюстрация. Сменная на случай фиксации стиля
// другим решением (YANDEX_ART_STYLE=...).
const artStyle = process.env.YANDEX_ART_STYLE ??
  'Современная стилизованная 3D-анимация в духе Pixar/DreamWorks: мягкая объёмная модель, большие выразительные глаза, тёплые персиково-оранжевые тона, мягкий студийный свет, чистый тёплый фон';
// Герой — по линейке (тот же канон, что lib/art-paths.ts): 5–7 Лис, 8–10 Мира, 11–13 Тима.
const HERO_BY_BAND: Record<string, string> = {
  '5-7': 'Главный герой эпизода — Лис: рыжий лис-«механик» в спецовке с карманами, большие уши (левое обвисшее), любопытный, не сдаётся.',
  '8-10': 'Главная героиня эпизода — Мира: девочка с косичкой-«антенной» из трёх резинок, комбинезон, рюкзак, блокнот при себе, замечает детали, не торопится.',
  '11-13': 'Главный герой эпизода — Тима: мальчик лет одиннадцати-тринадцати, в серо-синем худи, наушники на шее, планшет под мышкой, креативен, прячет доброту под «ок».',
};
const artDir = join(OUT_DIR, 'art');

const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(\d+-\d+)\.ink$/;

const scenes = walkInk()
  .map((file) => ({ file, match: AGE_BAND.exec(basename(file)) }))
  .filter((item): item is { file: string; match: RegExpExecArray } => Boolean(item.match))
  .filter((item) => !only || item.match[1].startsWith(only))
  .filter((item) => !bandFilter || item.match[2] === bandFilter);

const plan = Number.isFinite(limit) ? scenes.slice(0, limit) : scenes;
const total = plan.length * candidates;
const cost = total * rate;

console.log('Alice AI ART — сухой расчёт');
console.log(`  сцен к обработке: ${plan.length} (фильтр only=${only ?? 'все'})`);
console.log(`  кандидатов на сцену: ${candidates} → генераций: ${total}${bandFilter ? ` (линейка ${bandFilter})` : ''}`);
console.log(`  оценочная стоимость: ${cost.toFixed(2)} ₽ (курс ${rate} ₽/изображение, модель ${model}, размер ${size})`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
mkdirSync(artDir, { recursive: true });
const key = apiKey();
let generated = 0;
let failed = 0;
const jobs: { scene: string; band: string; candidate: number; prompt: string }[] = [];
for (const { file, match } of plan) {
  const [, scene, band] = match;
  const utterances = extractUtterances(readInk(file));
  const sceneText = utterances[0] ?? basename(file, '.ink');
  const hero = HERO_BY_BAND[band] ?? '';
  const prompt = [
    artStyle,
    hero,
    `Ситуация: ${sceneText}`,
    `Возраст зрителей: ${band} лет.`,
    'Добрые выразительные персонажи, безопасная, неспешная сцена. Без узнаваемых брендов и реальных людей, без текста в кадре.',
  ].filter(Boolean).join(' ');
  for (let candidate = 1; candidate <= candidates; candidate++) {
    jobs.push({ scene, band, candidate, prompt });
  }
}

await runPool(jobs, 3, async (job) => {
  const response = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: job.prompt, n: 1, size }),
  });
  if (!response.ok) {
    failed++;
    console.error(`  ! ${response.status} (${job.scene}-${job.band}#${job.candidate}): ${(await response.text()).slice(0, 300)}`);
    return;
  }
  const data = (await response.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0];
  const outFile = join(artDir, `${job.scene}-${job.band}-c${job.candidate}.png`);
  if (item?.b64_json) {
    writeFileSync(outFile, Buffer.from(item.b64_json, 'base64'));
    generated++;
  } else if (item?.url) {
    const image = await fetch(item.url);
    writeFileSync(outFile, Buffer.from(await image.arrayBuffer()));
    generated++;
  } else {
    failed++;
    console.error(`  ! Пустой ответ для ${outFile}`);
  }
  if (generated % 25 === 0) console.log(`  …сгенерировано ${generated} изображений`);
});

appendSpend({ tool: 'alice-ai-art', scenes: plan.length, candidates, generated, failed, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model });
console.log(`\nГотово: ${generated} изображений в ${artDir}, ошибок ${failed}. Просмотр и отбор — глазами, после — перенос отобранного в public/art.`);
if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
