/**
 * Кураторство кадров каталога одной командой: out/art/frames/<key>-c<N>.png →
 * public/art/frames/<key>.png (имя без суффикса — ровно путь из каталога).
 *
 *   сухой прогон:  npx tsx scripts/pick-frame.ts [--prefer=1|2] [--only=<substr>]
 *   применить:     npx tsx scripts/pick-frame.ts --yes [--prefer=1|2] [--only=<substr>] [--force]
 *
 * Существующие public/art/frames/<key>.png не перезаписываются без --force.
 * Для точечной замены одного кадра xmpите по --only=tima-workshop-thoughtful.
 * В git попадают только отобранные кадры (out/ — вне git).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const yes = argv.includes('--yes');
const force = argv.includes('--force');
const prefer = Number(argv.find((a) => a.startsWith('--prefer='))?.split('=')[1] ?? '1') || 1;
const only = argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const SRC = join('out', 'art', 'frames');
const DEST = join('public', 'art', 'frames');

const files = existsSync(SRC) ? readdirSync(SRC) : [];
const PAT = /^([a-z0-9-]+)-c(\d+)\.png$/;
const byKey = new Map<string, Map<number, string>>();
for (const name of files) {
  const match = PAT.exec(name);
  if (!match) continue;
  const [, key, cand] = match;
  const list = byKey.get(key) ?? new Map<number, string>();
  list.set(Number(cand), join(SRC, name));
  byKey.set(key, list);
}

const keys = [...byKey.keys()].filter((k) => !only || k.includes(only)).sort();
let planned = 0, skipped = 0, missing = 0;
const jobs: { key: string; src: string; dest: string }[] = [];
for (const key of keys) {
  const variants = byKey.get(key)!;
  const src = variants.get(prefer) ?? variants.get(1) ?? [...variants.values()][0];
  const dest = join(DEST, `${key}.png`);
  if (existsSync(dest) && !force) { skipped++; continue; }
  jobs.push({ key, src, dest });
  planned++;
}

console.log(`Кадры out/art/frames → public/art/frames  (prefer=c${prefer}${only ? `, фильтр “${only}”` : ''})`);
console.log(`  ключей найдено: ${keys.length}; к копированию: ${planned}; пропущено (уже есть): ${skipped}`);
for (const job of jobs.slice(0, 12)) console.log(`  ✓ ${job.key}`);
if (jobs.length > 12) console.log(`  … и ещё ${jobs.length - 12}`);
if (jobs.length === 0) console.log('  нечего копировать — проверьте, что out/art/frames существует и в нём есть *-cN.png');
if (!yes) {
  console.log('\nЭто был сухой прогон. Применить: добавьте --yes.');
  process.exit(0);
}
mkdirSync(DEST, { recursive: true });
for (const job of jobs) copyFileSync(job.src, job.dest);
console.log(`\nСкопировано ${jobs.length} файлов. Дальше: git add public/art/frames && git commit -m "Отобранные кадры" && git push`);
