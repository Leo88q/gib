/**
 * ОДНА КОМАНДА ДЛЯ МАКА: от ink до готового релиз-пакета контента.
 *
 * Что делает по --yes, по порядку:
 *   1. родительская серия вебинаров (локально, 0 ₽)
 *   2. проверка всех вебинаров LLM'ом (~80 ₽)
 *   3. раскадровки всех 121 сцены LLM'ом (~105 ₽)
 *   4. постановка сцен shotlist (LLM, ≈25 ₽) — снимает однообразие кадров
 *   5. каталог переиспользуемых кадров (0 ₽) → data/frame-catalog.json
 *   6. арт ПО КАТАЛОГУ: кадров ~24–120, а не 363 (см. docs/frame-reuse.md)
 *   7. stills: каталог → out/cinema/_stills (копии, 0 ₽)
 *   8. кино: Ken Burns + войс поверх кадров (0 ₽; требует _stills)
 *   9. тесты: test:content + test:cinema-manifest + test:frames + tsc
 *
 * БЕЗ --yes — сухой прогон: печатает, что будет сделано, объёмы и деньги.
 *
 * Отбор кадров (out/art → out/cinema/_stills) и вычитка вебинаров — работа
 * человека, код не может «увидеть». Всё остальное — автоматически.
 *
 * Примеры:
 *   npx tsx scripts/yandex-full-package.ts                    # сухой прогон
 *   YANDEX_API_KEY=КЛЮЧ npx tsx scripts/yandex-full-package.ts --yes --candidates=2
 *   YANDEX_API_KEY=КЛЮЧ npx tsx scripts/yandex-full-package.ts --yes --only=tests
 *   YANDEX_API_KEY=КЛЮЧ npx tsx scripts/yandex-full-package.ts --yes --band=8-10   # арт только под одну линейку
 *   YANDEX_API_KEY=КЛЮЧ npx tsx scripts/yandex-full-package.ts --yes --skip=art
 *   npm run build:frames      # пересобрать каталог кадров вручную (0 ₽)
 *   npm run stills:link       # разложить кадры по _stills вручную (0 ₽)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argValue, hasYesFlag } from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const candidates = Number(argValue(argv, 'candidates') ?? '2');
const band = argValue(argv, 'band'); // 5-7 | 8-10 | 11-13 — арт только под одну линейку
const only = argValue(argv, 'only');           // прогнать только одну фазу
const force = argv.includes('--force'); // перегенерация раскадровок и добора вебинаров
const skipRaw = argValue(argv, 'skip') ?? '';  // фазы через запятую
const skip = new Set(skipRaw.split(',').map((s) => s.trim()).filter(Boolean));

// Кадры считаем по каталогу (он коммитится); нет файла — эвристика «24 кадра».
let artFrames = 24;
try {
  const parsed = JSON.parse(readFileSync(join('data', 'frame-catalog.json'), 'utf8')) as { frames?: Record<string, { kind?: string; band?: string; disabled?: boolean }> };
  const usable = Object.values(parsed.frames ?? {}).filter((f) => !f.disabled);
  artFrames = usable.filter((f) => !band || f.kind === 'location' || f.band === band).length;
} catch { /* каталог ещё не собран — показываем пессимистичную оценку */ }
const artCost = artFrames * candidates * 2.23;

type Phase = { id: string; title: string; cost: string; run: [string, string[]]; needsKey: boolean; needsStills?: boolean };
const tsx = (script: string, ...flags: string[]): [string, string[]] => ['npx', ['tsx', script, ...flags]];

const phases: Phase[] = [
  { id: 'parent-webinars', title: 'Родительская серия вебинаров (12 файлов, код)', cost: '0 ₽', run: tsx('scripts/gen-parent-webinars.ts'), needsKey: false },
  { id: 'webinar-check', title: 'Самопроверка всех вебинаров LLM (48 файлов)', cost: '≈150 ₽', run: tsx('scripts/yandex-webinar-check.ts', '--yes'), needsKey: true },
  { id: 'storyboards', title: 'Раскадровки 121 сцены × 3 линейки LLM → data/storyboards.json', cost: '≈102 ₽', run: tsx('scripts/yandex-storyboard.ts', '--yes', ...(force ? ['--force'] : [])), needsKey: true },
  { id: 'expand-webinars', title: 'Добор учительских вебинаров до 25–30 мин LLM', cost: '≈125 ₽', run: tsx('scripts/expand-webinars.ts', '--yes', ...(force ? ['--force'] : [])), needsKey: true },
  { id: 'art-stage', title: 'Постановка сцен shotlist (LLM, один раз на сцену) — УБИРАЕТ ОДНООБРАЗИЕ', cost: '≈25 ₽', run: tsx('scripts/art-stage.ts', '--yes'), needsKey: true },
  { id: 'catalog', title: 'Каталог переиспользуемых кадров → data/frame-catalog.json (0 ₽)', cost: '0 ₽', run: tsx('scripts/build-frame-catalog.ts'), needsKey: false },
  { id: 'art', title: `Арт ПО КАТАЛОГУ${band ? ` (линейка ${band})` : ''}: ${artFrames} кадров × ${candidates} канд. = ${artFrames * candidates} генераций (вместо ${(band ? 121 : 363) * candidates})`, cost: `≈${artCost.toFixed(0)} ₽`, run: tsx('scripts/yandex-art-frames.ts', `--candidates=${candidates}`, ...(band ? [`--band=${band}`] : []), '--yes'), needsKey: true },
  { id: 'stills', title: 'Разложить кадры каталога по out/cinema/_stills (копии, 0 ₽)', cost: '0 ₽', run: tsx('scripts/link-frame-stills.ts', '--yes'), needsKey: false },
  { id: 'cinema', title: 'Кино: Ken Burns + войс из _stills → out/cinema + manifest', cost: '0 ₽', run: tsx('scripts/render-cinema.ts'), needsKey: false, needsStills: true },
  { id: 'cinema-manifest', title: 'Кино: сборка public/cinema/manifest.json', cost: '0 ₽', run: tsx('scripts/build-cinema-manifest.ts'), needsKey: false },
  { id: 'tests', title: 'Проверки: test:content + test:cinema-manifest + tsc', cost: '0 ₽', run: ['npm', ['run', 'test:content']], needsKey: false },
];

const selected = phases.filter((phase) => (!only || phase.id === only) && !skip.has(phase.id));
const stillsCount = existsSync(join('out', 'cinema', '_stills'))
  ? readdirSync(join('out', 'cinema', '_stills')).filter((f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')).length
  : 0;

console.log('Релиз-пакет контента — план');
console.log(`выбор: ${selected.map((p) => p.id).join(', ') || 'ничего (всё отфильтровано)'}`);
console.log(`кадров в _stills: ${stillsCount}`);
for (const phase of selected) {
  const note = phase.needsStills && stillsCount === 0 ? '  ← ПРОПУЩУ (нет _stills — сначала отбор кадров)' : '';
  console.log(`  • ${phase.title} — ${phase.cost}${note}`);
}
console.log(`\nИтого денег (без трат, уже совершённых): ≈${(150 + 102 + (skip.has('expand-webinars') || only === 'tests' ? 0 : 125) + (skip.has('art-stage') ? 0 : 25) + (skip.has('art') ? 0 : artCost)).toFixed(0)} ₽ (проверка 150 + раскадровки 102 + добор 125 + shotlist 25 + арт по каталогу ${artCost.toFixed(0)})`);
if (force) console.log('  --force: раскадровки 121 сцена и добор всех 38 вебинаров перегенерируются заново (весь объём оплачивается повторно).');
console.log('Остаток гранта на старте этого прогона ≈ 7 900 ₽ (минус уже потраченное на сайте Yandex Cloud, если было).\n');

if (!yes) {
  console.log('Это был сухой прогон. Запуск ВСЕГО: добавьте --yes и YANDEX_API_KEY в окружение.');
  console.log('Только проверки, без трат: npx tsx scripts/yandex-full-package.ts --yes --only=tests');
  process.exit(0);
}

const failures: string[] = [];
for (const phase of selected) {
  if (phase.needsStills && stillsCount === 0) {
    console.log(`\n=== ПРОПУСК: ${phase.id} — нет out/cinema/_stills (нужен ваш отбор кадров)`);
    continue;
  }
  console.log(`\n=== ${phase.title}`);
  const [bin, args] = phase.run;
  const result = spawnSync(bin, args, { stdio: 'inherit', env: process.env, shell: false });
  if (result.status !== 0) failures.push(phase.id);
  if (phase.id === 'tests') {
    for (const extra of [['npm', 'run', 'test:cinema-manifest'], ['npm', 'run', 'test:frames'], ['npx', 'tsc', '--noEmit']]) {
      const r = spawnSync(extra[0], extra.slice(1), { stdio: 'inherit', env: process.env });
      if (r.status !== 0) failures.push(`tests:${extra.slice(1).join(' ')}`);
    }
  }
}

if (failures.length) {
  console.error(`\nПРОВАЛЕНО: ${failures.join(', ')}. Изучите вывод выше; повторный запуск фазы: --only=<id>.`);
  process.exit(1);
}
console.log('\nГОТОВО. Итоги расхода: out/ai-grant-spend.jsonl. Дальше — глазами: отбор _stills, вычитка вебинаров, «сливай» для мержа.');
