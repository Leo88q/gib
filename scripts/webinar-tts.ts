/**
 * Озвучка видео-вебинаров через Yandex SpeechKit (TTS v1), голос alena.
 *
 * Что делает: берёт слайды из сборщика плана (та же логика, что в
 * build-webinar-video-plan.ts), схлопывает полные дубликаты реплик по хэшу,
 * в сухом прогоне печатает объём и цену, с --yes синтезирует mp3 в
 * out/webinars/audio/<hash>.mp3, пишет out/webinars/audio-manifest.json и
 * дописывает out/ai-grant-spend.jsonl.
 *
 * Существующие mp3 не перегенерируются (переделать — удалите файл или --force).
 * Тексты вычитаны и финальны; скрипт их не переписывает, только снимает
 * markdown-разметку (**жирный**, списки) для чистого произношения.
 *
 * Запуск:
 *   npx tsx scripts/webinar-tts.ts                       # сухой прогон: объём и цена
 *   npx tsx scripts/webinar-tts.ts --audience=parent     # только родительская серия
 *   YANDEX_API_KEY=... npx tsx scripts/webinar-tts.ts --yes
 *   YANDEX_API_KEY=... npx tsx scripts/webinar-tts.ts --yes --limit=20 --force
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, utteranceHash, OUT_DIR,
} from './yandex-api.ts';
import { TTS_RATE_RUB_PER_1K, buildPlan, type WebinarAudience } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const rate = Number(argValue(argv, 'rate') ?? String(TTS_RATE_RUB_PER_1K));
const force = argv.includes('--force');
const voice = process.env.YANDEX_TTS_VOICE ?? 'alena';
const audience = argValue(argv, 'audience') as WebinarAudience | undefined;
const slugFilter = argValue(argv, 'slug');
if (audience && audience !== 'teacher' && audience !== 'parent') {
  console.error('--audience: teacher | parent');
  process.exit(1);
}

const audioDir = join(OUT_DIR, 'webinars', 'audio');
const plan = buildPlan(audience, slugFilter);

// Уникальные реплики по хэшу — полные дубликаты оплачиваются один раз.
const unique = new Map<string, string>();
for (const w of plan.webinars) {
  for (const s of w.slides) if (!unique.has(s.hash)) unique.set(s.hash, s.narration);
}

const all = [...unique.entries()];
const todo = Number.isFinite(limit) ? all.slice(0, limit) : all;
const chars = todo.reduce((sum, [, text]) => sum + text.length, 0);
const cost = (chars / 1000) * rate;
const totalSlides = plan.webinars.reduce((sum, w) => sum + w.slides.length, 0);

console.log('Видео-вебинары — SpeechKit TTS');
console.log(`  выпусков: ${plan.webinars.length} | слайдов: ${totalSlides} | уникальных реплик: ${all.length}`);
console.log(`  к синтезу: ${todo.length} реплик (${chars} симв.) ≈ ${cost.toFixed(2)} ₽ (голос ${voice}, ${rate} ₽/1000 симв.)`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
  mkdirSync(audioDir, { recursive: true });
  const key = apiKey();
  let done = 0;
  let failed = 0;
  const manifest: { hash: string; out: string; chars: number; sample: string }[] = [];

  await runPool(todo, 4, async ([hash, text]) => {
    const target = join(audioDir, `${hash}.mp3`);
    manifest.push({ hash, out: target, chars: text.length, sample: text.slice(0, 80) });
    if (existsSync(target) && !force) { done++; return; }
    const response = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ folderId: folderId(), text: text.slice(0, 4500), lang: 'ru-RU', voice, format: 'mp3' }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} для «${text.slice(0, 60)}…»: ${(await response.text()).slice(0, 200)}`);
      return;
    }
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    done++;
    if (done % 50 === 0) console.log(`  …синтезировано ${done}/${todo.length}`);
  });

  writeFileSync(join(OUT_DIR, 'webinars', 'audio-manifest.json'), JSON.stringify({ at: new Date().toISOString(), voice, items: manifest }, null, 2));
  appendSpend({ tool: 'webinar-tts', slides: totalSlides, unique: todo.length, synthesized: done, failed, chars, cost_estimate_rub: cost, voice });
  console.log(`\nГотово: ${done}/${todo.length} mp3 в ${audioDir}, ошибок ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
