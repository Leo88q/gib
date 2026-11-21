/**
 * ОДНА КОМАНДА ДЛЯ МАКА: от ink до готового релиз-пакета контента.
 *
 * Что делает по --yes, по порядку:
 *   1. родительская серия вебинаров (локально, 0 ₽)
 *   2. проверка всех вебинаров LLM'ом (~80 ₽)
 *   3. раскадровки всех 121 сцены LLM'ом (~105 ₽)
 *   4. арт: Alice AI ART по всем сценам (N кандидатов; каждый кадр 2,23 ₽)
 *   5. кино: Ken Burns + войс поверх отобранных кадров (0 ₽; требует _stills)
 *   6. тесты: test:content + test:cinema-manifest + tsc
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
 *   YANDEX_API_KEY=КЛЮЧ npx tsx scripts/yandex-full-package.ts --yes --skip=art
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { argValue, hasYesFlag } from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const candidates = Number(argValue(argv, 'candidates') ?? '2');
const only = argValue(argv, 'only');           // прогнать только одну фазу
const skipRaw = argValue(argv, 'skip') ?? '';  // фазы через запятую
const skip = new Set(skipRaw.split(',').map((s) => s.trim()).filter(Boolean));

const SCENE_FILES = 363; // 121 сцена × 3 линейки
const artCost = SCENE_FILES * candidates * 2.23;

type Phase = { id: string; title: string; cost: string; run: [string, string[]]; needsKey: boolean; needsStills?: boolean };
const tsx = (script: string, ...flags: string[]): [string, string[]] => ['npx', ['tsx', script, ...flags]];

const phases: Phase[] = [
  { id: 'parent-webinars', title: 'Родительская серия вебинаров (12 файлов, код)', cost: '0 ₽', run: tsx('scripts/gen-parent-webinars.ts'), needsKey: false },
  { id: 'webinar-check', title: 'Самопроверка всех вебинаров LLM (48 файлов)', cost: '≈150 ₽', run: tsx('scripts/yandex-webinar-check.ts', '--yes'), needsKey: true },
  { id: 'storyboards', title: 'Раскадровки 121 сцены × 3 линейки LLM → data/storyboards.json', cost: '≈102 ₽', run: tsx('scripts/yandex-storyboard.ts', '--yes'), needsKey: true },
  { id: 'expand-webinars', title: 'Добор учительских вебинаров до 25–30 мин LLM', cost: '≈125 ₽', run: tsx('scripts/expand-webinars.ts', '--yes'), needsKey: true },
  { id: 'art', title: `Арт по всем сценам, ${candidates} канд./сцену (${SCENE_FILES * candidates} кадров)`, cost: `≈${artCost.toFixed(0)} ₽`, run: tsx('scripts/yandex-art.ts', '--candidates', String(candidates), '--yes'), needsKey: true },
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
console.log(`\nИтого денег (без трат, уже совершённых): ≈${(75 + 105 + (skip.has('expand-webinars') || only === 'tests' ? 0 : 125) + (skip.has('art') ? 0 : artCost)).toFixed(0)} ₽ (проверка 150 + раскадровки 102 + добор 125 + арт ${artCost.toFixed(0)})`);
console.log('Остаток гранта на старте этого прогона ≈ 7 900 ₽. Полный прогон с артом оставит ≈ 6 100 ₽.\n');

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
    for (const extra of [['npm', 'run', 'test:cinema-manifest'], ['npx', 'tsc', '--noEmit']]) {
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
