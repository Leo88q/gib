/**
 * Генерация канонических кадров каста «Театральной мастерской»: Сова Тася и Бельчонок Сёпа.
 *
 * По решению владельца (подтверждено 23.11.2026): приоритет 1 арт-плана — по
 * каноническому кадру + 4 эмоции (радость / грусть / сомнение / злость) на каждого.
 * Выход: out/art/cast/<id>-<emotion>-c<N>.png; включение в продукт — только после
 * глазной отборки кадров и переноса в design/characters/.
 *
 * Сухой прогон (0 ₽): npm run gen:cast
 * Боевой (на маке владельца): YANDEX_API_KEY=... npm run gen:cast -- --yes
 * Фильтры: --only=tasya | --only=syopa · --candidates=2 · --force
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only');
const candidates = Number(argValue(argv, 'candidates') ?? '2');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? '2.23');
const model = process.env.YANDEX_ART_MODEL ?? `art://${folderId()}/aliceai-image-art-3.0/latest`;
// 9:16 проверен на аккаунте владельца; канон просит 3:4 — попробуйте YANDEX_ART_SIZE=768x1024 на 1 кадре.
const size = process.env.YANDEX_ART_SIZE ?? '1024x1792';
const base = process.env.YANDEX_ART_BASE ?? process.env.YANDEX_LLM_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
const artDir = join(OUT_DIR, 'art', 'cast');

const STYLE = 'Современная стилизованная 3D-анимация (Pixar/DreamWorks): мягкие объёмы, круглая «книжная» объёмность, тёплые персиково-оранжевые тона, мягкий студийный свет, фон бумага #FDF4E9.';
const FRAME = 'Композиция: полный рост, ракурс три четверти, лицо в верхней трети, воздух над головой, без текста и букв в кадре, без брендов, без реальных людей. Пропорции сказочных героев — 3–4 головы в тело.';

const CAST: Record<string, { name: string; canon: string }> = {
  tasya: {
    name: 'Сова Тася',
    canon: 'Большая круглая сова: круглые очки, библиотечный кардиган, в лапах толстая книга (обложка без надписей). Характер: не торопится, слышит паузу, говорит тихо и точно. Хранительница «Тихой комнаты» в библиотеке: передышки и дыхательные паузы.',
  },
  syopa: {
    name: 'Бельчонок Сёпа',
    canon: 'Младший «стажёр» Мастерской Лиса: малявка в спецовке вдвое меньшей лисиной, «вихор» на голове, щёки в саже, кисточка вместо отвёртки. Характер: суетится, ошибается честно, радуется каждому «получилось».',
  },
};
// 5 постановок на каждого: канон + 4 эмоции (один и тот же герой, поза/мимика меняется).
const EMOTIONS: Record<string, string> = {
  canonical: 'Спокойная нейтральная стойка (канон каста).',
  joy: 'Эмоция: радость — мягкая улыбка, добрые прищуренные глаза.',
  sad: 'Эмоция: грусть — уголки вниз, тихо прикрытые глаза; не страшно, не жалко, «бывает».',
  doubt: 'Эмоция: сомнение — взгляд в сторону, одна лапа у щеки.',
  angry: 'Эмоция: злость — брови сведены, книга прижата к груди (Тася) / кисточка сжата в лапе (Сёпа); детская «сердитка», не пугающая.',
};

const jobs: { id: string; prompt: string; outFile: string }[] = [];
let skipped = 0;
for (const [id, castEntry] of Object.entries(CAST)) {
  if (only && only !== id) continue;
  for (const [emotion, staging] of Object.entries(EMOTIONS)) {
    for (let c = 1; c <= candidates; c += 1) {
      const outFile = join(artDir, `${id}-${emotion}-c${c}.png`);
      if (existsSync(outFile) && !force) { skipped++; continue; }
      jobs.push({ id, outFile, prompt: `${STYLE} ${castEntry.canon} ${staging} ${FRAME}` });
    }
  }
}
const total = jobs.length;
const cost = total * rate;

console.log('Каст «Театральной мастерской» — Тася и Сёпа (Alice AI ART)');
console.log(`  персонажей: ${only ?? 'все'} | постановок: 5 на персонажа (канон + 4 эмоции) | кандидатов: ${candidates}`);
console.log(`  уже готово (пропущено): ${skipped} | к генерации: ${total} → ≈ ${cost.toFixed(2)} ₽ (${rate} ₽/изображение, ${size})`);
if (jobs[0]) console.log(`\nПример промпта (${jobs[0].outFile}):\n${jobs[0].prompt}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Боевой запуск на маке владельца: добавьте --yes (и YANDEX_API_KEY в окружение).');
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
      console.error(`  ! ${response.status} (${job.outFile}): ${(await response.text()).slice(0, 300)}`);
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
    console.log(`  …${generated + failed}/${jobs.length}`);
  });

  appendSpend({ tool: 'cast-tasya-syopa', generated, failed, candidates, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model, size });
  console.log(`\nГотово: ${generated} кадров в ${artDir}, ошибок ${failed}. Отбор глазами — и только потом перенос в design/characters/.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
