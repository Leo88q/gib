/**
 * Эталонные кадры Лиса/Миры/Тимы для последующей конвертации в 3D (image-to-3D).
 *
 * Отличие от кадров к слайдам: фронтальный вид в полный рост, A-поза, нейтральный
 * светло-серый фон, рассеянный свет без художественных теней — чистый вход для
 * TripoSR / InstantMesh / TRELLIS.2. Стиль (Pixar/DreamWorks) тот же, что у ART-кадров.
 *
 * Результат — ОДИН постоянный эталон на персонажа: все дальнейшие 3D-сцены,
 * титры и вставки собираются из него, без перегенерации.
 *
 * Запуск:
 *   node --experimental-strip-types scripts/studio-ref-art.ts          # сухой прогон, 0 ₽
 *   YANDEX_API_KEY=... YANDEX_FOLDER_ID=... node --experimental-strip-types scripts/studio-ref-art.ts --yes
 * Файлы: out/studio-3d/ref-lis.png, ref-mira.png, ref-tima.png
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, hasYesFlag, OUT_DIR,
} from './yandex-api.ts';
import { ART_RATE_RUB_PER_IMAGE } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const force = argv.includes('--force');
const rate = ART_RATE_RUB_PER_IMAGE;
const folder = process.env.YANDEX_FOLDER_ID ?? 'b1g4u6puplb11nlqbjlg';
const model = process.env.YANDEX_ART_MODEL ?? `art://${folder}/aliceai-image-art-3.0/latest`;
const size = process.env.YANDEX_ART_SIZE ?? '1024x1024';
const base = process.env.YANDEX_ART_BASE ?? process.env.YANDEX_LLM_BASE ?? 'https://ai.api.cloud.yandex.net/v1';
const artStyle = process.env.YANDEX_ART_STYLE ??
  'Современная стилизованная 3D-анимация (Pixar/DreamWorks): мягкие объёмы, большие выразительные глаза, тёплые персиково-оранжевые тона, мягкий студийный свет';

const STYLE_SUFFIX =
  'Фронтальный вид строго анфас, во весь рост, спокойная A-поза (руки слегка разведены, ноги на ширине плеч), ' +
  'нейтральный светло-серый однородный фон без предметов, равномерное рассеянное освещение, минимальный мягкий контактный контур-тень, ' +
  'голова не закрыта, лицо и силуэт читаются полностью.';

const REFERENCES = [
  {
    name: 'ref-lis',
    title: 'Лис',
    prompt:
      `${artStyle}. Эталонный кадр для 3D-конвертации персонажа программы «Гиб»: Лис — рыжий лис-механик ` +
      `в тёпло-коричневой спецовке с карманами и потёртым кожаным ремнём, большие уши, умный взгляд. ` +
      `${STYLE_SUFFIX} Без надписей, букв и цифр; без брендов; один персонаж; без реквизита.`,
  },
  {
    name: 'ref-mira',
    title: 'Мира',
    prompt:
      `${artStyle}. Эталонный кадр для 3D-конвертации персонажа программы «Гиб»: Мира — девочка с косичкой-«антенной» ` +
      `из трёх резинок, тёплый жёлто-зелёный комбинезон, любопытное доброе лицо. ` +
      `${STYLE_SUFFIX} Без надписей, букв и цифр; без брендов; один персонаж; без реквизита в руках.`,
  },
  {
    name: 'ref-tima',
    title: 'Тима',
    prompt:
      `${artStyle}. Эталонный кадр для 3D-конвертации персонажа программы «Гиб»: Тима — мальчик лет одиннадцати, ` +
      `серо-синее худи, наушники на шее, задумчивое дружелюбное лицо. ` +
      `${STYLE_SUFFIX} Без надписей, букв и цифр; без брендов; один персонаж; без реквизита в руках.`,
  },
] as const;

const outDir = join(OUT_DIR, 'studio-3d');
const jobs = REFERENCES
  .map((ref) => ({ ...ref, outFile: join(outDir, `${ref.name}.png`) }))
  .filter((ref) => force || !existsSync(ref.outFile));
const skipped = REFERENCES.length - jobs.length;

console.log('Эталонные кадры под 3D (Лис, Мира, Тима) — Alice AI ART');
console.log(`  к генерации: ${jobs.length} | уже готовы: ${skipped} | стоимость ≈ ${(jobs.length * rate).toFixed(2)} ₽ (${rate} ₽/шт, ${size})`);
for (const job of jobs) console.log(`\n— ${job.title} (${job.outFile}):\n${job.prompt}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const key = apiKey();
  let generated = 0;
  let failed = 0;

  for (const job of jobs) {
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: job.prompt, n: 1, size }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${job.name}): ${(await response.text()).slice(0, 300)}`);
      continue;
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
  }

  appendSpend({ tool: 'studio-ref-art', generated, failed, rate_per_image_rub: rate, cost_estimate_rub: generated * rate, model, size });
  console.log(`\nГотово: ${generated} файлов в ${outDir}, ошибок ${failed}. Каждый персонаж — один эталон: дальше только 3D.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
