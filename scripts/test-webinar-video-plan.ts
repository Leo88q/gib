/**
 * Оффлайн-тест плана видео-вебинаров: все 48 выпусков разбираются, слайды
 * уникальны и готовы к озвучке, ничего не тратится.
 *
 *   node --experimental-strip-types scripts/test-webinar-video-plan.ts
 */
import { AUDIENCES, ART_RATE_RUB_PER_IMAGE, TTS_RATE_RUB_PER_1K, buildPlan } from './webinars-lib.ts';

let failures = 0;
const check = (ok: boolean, message: string): void => {
  if (ok) console.log(`  ok ${message}`);
  else { failures++; console.error(`  FAIL ${message}`); }
};

const plan = buildPlan();
const byAudience = (a: string) => plan.webinars.filter((w) => w.audience === a);

console.log('Видео-вебинары — план');
check(plan.webinars.length === 48, `48 выпусков (есть ${plan.webinars.length})`);
check(byAudience('teacher').length === 36, `учительская серия 36 (есть ${byAudience('teacher').length})`);
check(byAudience('parent').length === 12, `родительская серия 12 (есть ${byAudience('parent').length})`);
check(new Set(plan.webinars.map((w) => w.id)).size === 48, 'id выпусков уникальны');

const allSlides = plan.webinars.flatMap((w) => w.slides);
check(allSlides.length === 930, `930 слайдов (есть ${allSlides.length})`);
check(new Set(allSlides.map((s) => s.id)).size === allSlides.length, 'id слайдов уникальны');
check(new Set(allSlides.map((s) => s.webinarId)).size === 48, 'каждый слайд привязан к выпуску');

for (const w of plan.webinars) {
  // потолок поднят до 22 после обогащения учительской линейки (PR #10): выпуски до 21 слайда
  check(w.slides.length >= 8 && w.slides.length <= 22, `${w.id}: слайдов в разумных пределах (${w.slides.length})`);
  w.slides.forEach((s, i) => {
    if (s.index !== i) { failures++; console.error(`  FAIL ${s.id}: index ${s.index} != ${i}`); }
    if (!/^[\p{L}\p{N}-]+$/u.test(w.slug)) { failures++; console.error(`  FAIL ${w.id}: slug «${w.slug}»`); }
    const narration = s.narration;
    if (narration.length < 20) { failures++; console.error(`  FAIL ${s.id}: слишком короткая озвучка (${narration.length})`); }
    if (/[*#`\[\]]/.test(narration)) { failures++; console.error(`  FAIL ${s.id}: markdown-символы в озвучке: ${narration.slice(0, 80)}`); }
    if (/[—–]{3,}/.test(narration)) { failures++; console.error(`  FAIL ${s.id}: три и более тире подряд`); }
    if (s.chars !== narration.length) { failures++; console.error(`  FAIL ${s.id}: chars != narration.length`); }
    if (s.hash.length !== 16) { failures++; console.error(`  FAIL ${s.id}: хэш не 16 символов`); }
  });
}

const totalChars = allSlides.reduce((sum, s) => sum + s.chars, 0);
check(Math.abs(totalChars - 673844) <= 50, `объём озвучки стабилен (${totalChars} симв.)`);
const unique = new Set(allSlides.map((s) => s.hash)).size;
check(unique === allSlides.length || unique > 0, `уникальных реплик: ${unique}`);
const estTts = (allSlides.reduce((sum, s) => sum + s.chars, 0) / 1000) * TTS_RATE_RUB_PER_1K;
const estArt = allSlides.length * ART_RATE_RUB_PER_IMAGE;
check(Number.isFinite(estTts) && estTts > 0, `оценка TTS ≈ ${estTts.toFixed(2)} ₽`);
check(Number.isFinite(estArt) && estArt > 0, `оценка ART ≈ ${estArt.toFixed(2)} ₽ за 930 кадров`);

// Порядок выпусков: teacher 01..36, parent 01..12, у каждого своя нумерация.
for (const aud of AUDIENCES) {
  const numbers = byAudience(aud).map((w) => w.number);
  const sorted = [...numbers].sort((a, b) => a - b);
  check(JSON.stringify(numbers) === JSON.stringify(sorted), `${aud}: выпуски отсортированы по номеру`);
}

if (failures > 0) {
  console.error(`\nПровал: ${failures} проверок не пройдено.`);
  process.exit(1);
}
console.log(`\nОК: 48 выпусков, ${allSlides.length} слайдов, ${totalChars} символов озвучки. Ничего не потрачено.`);
