/**
 * Смета и манифест видео-вебинаров (сухой прогон — ничего не тратит).
 *
 * Что делает: разбирает все вычитанные content/webinars/*\/*​.full.md, режет
 * секцию «## Текст озвучки» на слайды (абзацы до первого «### » — «Вступление»),
 * считает символы для TTS и число уникальных кадров для Alice AI ART, пишет
 * out/webinars/plan.json и печатает сводку по выпуску и по проекту.
 *
 * Стоит 0 ₽. Запуск:
 *   npx tsx scripts/build-webinar-video-plan.ts
 *   npx tsx scripts/build-webinar-video-plan.ts --audience=parent --slug=01
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argValue } from './yandex-api.ts';
import { OUT_WEBINARS, buildPlan, type WebinarAudience, ART_RATE_RUB_PER_IMAGE } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const audience = argValue(argv, 'audience') as WebinarAudience | undefined;
const slug = argValue(argv, 'slug');
if (audience && audience !== 'teacher' && audience !== 'parent') {
  console.error('--audience: teacher | parent');
  process.exit(1);
}

const plan = buildPlan(audience, slug);

console.log('Видео-вебинары — смета (0 ₽, только расчёт)');
console.log(`  выпусков: ${plan.totals.webinars} | слайдов: ${plan.totals.slides} | очищено символов для TTS: ${plan.totals.chars}`);
console.log(`  уникальных реплик: ${plan.totals.uniqueNarrations} (${plan.totals.uniqueChars} симв.) → озвучка ≈ ${plan.totals.estTtsRub.toFixed(2)} ₽`);
console.log(`  уникальных кадров ART: ${plan.totals.slides} × ${ART_RATE_RUB_PER_IMAGE} ₽ ≈ ${plan.totals.estArtRubPerCandidate.toFixed(2)} ₽ за 1 кандидата`);
console.log('');
for (const w of plan.webinars) {
  console.log(`  [${w.audience}] ${String(w.number).padStart(2, '0')} ${w.title.slice(0, 46).padEnd(46)} слайдов ${String(w.slides.length).padStart(2)} | ${String(w.chars).padStart(6)} симв. | ≈${w.estTtsRub.toFixed(2)} ₽`);
}

mkdirSync(OUT_WEBINARS, { recursive: true });
const out = join(OUT_WEBINARS, 'plan.json');
writeFileSync(out, JSON.stringify(plan, null, 2));
console.log(`\nМанифест: ${out}`);
console.log('Это был сухой прогон. Ничего не потрачено. Озвучка: scripts/webinar-tts.ts --yes; кадры: scripts/webinar-art.ts --yes; сборка: scripts/render-webinar-video.ts (локально, 0 ₽).');
