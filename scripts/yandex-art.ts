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
 * Постановка берётся из data/art-shotlist.json (создаётся scripts/art-stage.ts,
 * ревьюит человек). Без него работает оффлайн-эвристика по ключевым словам.
 * 4 кандидата на сцену различаются камерой структурно (VARIANTS), а не «ещё раз тот же».
 * Вертикальный кадр для Reels: YANDEX_ART_SIZE=1024x1792 (проверьте на 1 кадре).
 *
 * Запуск:
 *   npx tsx scripts/yandex-art.ts                  # сухой прогон: объём и цена + пример промпта
 *   npx tsx scripts/yandex-art.ts --only=w1        # только неделя 1
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-art.ts --yes --only=w1 --candidates=4
 *
 * Если Images API отвечает ошибкой, сверьте точный model-URI в карточке модели
 * (AI Studio → Model Gallery → Alice AI ART → «Код») и передайте его через
 * YANDEX_ART_MODEL; базовый адрес можно сменить через YANDEX_ART_BASE.
 * (Проверено на каталоге пользователя 21.11.2026:
 *  model = art://<folder>/aliceai-image-art-3.0/latest,
 *  base  = https://ai.api.cloud.yandex.net/v1.)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
// Стиль — короткий якорь; постановку несёт shotlist (data/art-shotlist.json) и VARIANTS.
const artStyle = process.env.YANDEX_ART_STYLE ??
  'Современная стилизованная 3D-анимация (Pixar/DreamWorks): мягкие объёмы, большие выразительные глаза, тёплые персиково-оранжевые тона, мягкий студийный свет';
// Герой — по линейке (тот же канон, что lib/art-paths.ts): 5–7 Лис, 8–10 Мира, 11–13 Тима.
const HERO_BY_BAND: Record<string, string> = {
  '5-7': 'Главный герой эпизода — Лис: рыжий лис-«механик» в спецовке с карманами, большие уши (левое обвисшее), любопытный, не сдаётся.',
  '8-10': 'Главная героиня эпизода — Мира: девочка с косичкой-«антенной» из трёх резинок, комбинезон, рюкзак, блокнот при себе, замечает детали, не торопится.',
  '11-13': 'Главный герой эпизода — Тима: мальчик лет одиннадцати-тринадцати, в серо-синем худи, наушники на шее, планшет под мышкой, креативен, прячет доброту под «ок».',
};

// --- Постановка сцены ---------------------------------------------------------
type ShotEntry = {
  location: string;
  action: string;
  emotion: string;
  props?: string[];
  video_role?: string;
  needs_review?: boolean;
};

/** Постановки, развёрнутые scripts/art-stage.ts и отревьюированные человеком. */
function loadShotlist(): Record<string, ShotEntry> {
  try {
    return JSON.parse(readFileSync(join('data', 'art-shotlist.json'), 'utf8')) as Record<string, ShotEntry>;
  } catch {
    return {};
  }
}
const shotlist = loadShotlist();

// Оффлайн-эвристика на случай отсутствия shotlist: локация по ключевым словам.
const LOC_HINTS: [RegExp, string][] = [
  [/крас|мастер|инструмент|самодел|почин/i, 'мастерская'],
  [/книг|библиотек|читальн/i, 'библиотека'],
  [/рын|покупа|лавк|ярмар/i, 'рынок'],
  [/тепли|растени|семен|сад/i, 'теплица'],
  [/площадк|качел|горк/i, 'площадка'],
  [/двор|улиц/i, 'двор'],
  [/парк|алле/i, 'парк'],
  [/урок|класс|учитель|школа/i, 'класс'],
  [/дом|комнат|кладов/i, 'комната'],
];
function heuristicStage(text: string): ShotEntry {
  const location = LOC_HINTS.find(([re]) => re.test(text))?.[1] ?? 'комната';
  const firstSentence = (text.split(/[.!?]/)[0] ?? '').trim();
  const action = firstSentence.slice(0, 80) || 'смотрит на предмет в руках';
  return { location, action, emotion: 'спокойный, добрый', props: [], video_role: 'start-frame', needs_review: true };
}

/** Четыре структурно разных кадра на сцену (ротация по номеру кандидата). */
const VARIANTS = [
  'общий план, камера вровень, анфас, симметричная композиция',
  'средний план, ракурс три четверти, правило третей',
  'крупный план, лёгкий верхний ракурс, правило третей',
  'общий план, лёгкий нижний ракурс, ведущая линия',
] as const;

const REELS_CONSTRAINT =
  'Композиция для вертикального Reels: один герой в кадре, герой по центру по вертикали с воздухом над головой и под ногами, конечности не перекрыты, поза с потенциалом движения, без motion blur, без текста и букв, без брендов и реальных людей.';

const buildPrompt = (scene: string, band: string, sceneText: string, candidate: number): string => {
  const hero = HERO_BY_BAND[band] ?? '';
  const staging = shotlist[scene] ?? heuristicStage(sceneText);
  const variant = VARIANTS[(candidate - 1) % VARIANTS.length];
  const props = (staging.props ?? []).filter(Boolean).slice(0, 3).join(', ');
  return [
    `${artStyle}.`,
    hero,
    `Кадр: ${variant}.`,
    `Локация: ${staging.location}${props ? `; опорные детали: ${props}` : ''}.`,
    `Действие: ${staging.action}. Эмоция: ${staging.emotion}.`,
    REELS_CONSTRAINT,
  ].filter(Boolean).join(' ');
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
if (plan[0]) {
  const first = plan[0];
  const sceneSample = first.match[1];
  const bandSample = first.match[2];
  const sceneTextSample = extractUtterances(readInk(first.file)).slice(0, 2).join(' ').slice(0, 240);
  console.log(`\nПример промпта (кандидатура 1 для ${sceneSample}-${bandSample}):\n${buildPrompt(sceneSample, bandSample, sceneTextSample, 1)}`);
  console.log(`Shotlist: ${Object.keys(shotlist).length} постановок из data/art-shotlist.json${Object.keys(shotlist).length === 0 ? ' (не найден — оффлайн-эвристика, needs_review)' : ''}`);
}

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
  // Только для оффлайн-эвристики: shotlist из art-stage.ts приоритетнее.
  const sceneText = extractUtterances(readInk(file)).slice(0, 2).join(' ').slice(0, 240);
  for (let candidate = 1; candidate <= candidates; candidate++) {
    jobs.push({ scene, band, candidate, prompt: buildPrompt(scene, band, sceneText, candidate) });
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
