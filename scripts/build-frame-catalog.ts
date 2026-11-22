/**
 * Сборка каталога переиспользуемых кадров data/frame-catalog.json (0 ₽, оффлайн).
 *
 * Зачем: один и тот же кадр («Лис в мастерской, спокойный») вставляется во
 * все сцены с той же постановкой, а не генерируется заново на каждый урок.
 * Каталог — связка «семантический ключ → файл + список сцен, которым он нужен».
 *
 * Источники, по приоритету:
 *   1) data/art-shotlist.json (art-stage, если уже сгенерирован) — точные
 *      локации и эмоции, источник 'shotlist';
 *   2) оффлайн-эвристика по ink — всё помечается needs_review: true.
 *
 * Повторный запуск СОХРАНЯЕТ ручные правки: path, verified, disabled, note
 * человека не пересоздаются; used_by всегда пересчитывается из кода.
 *
 * Запуск:  npx tsx scripts/build-frame-catalog.ts [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { extractUtterances, readInk, walkInk } from './yandex-api.ts';
import {
  deriveStage, heroFrameKey, locationFrameKey, loadShotlist, HERO_BY_BAND,
  type Stage,
} from './frame-stage.ts';

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const CATALOG = join('data', 'frame-catalog.json');

const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(\d+-\d+)\.ink$/;

// Уникальные сцены: dedup по basename (deep/ и week-one/ — одни и те же файлы).
const perScene = new Map<string, { scene: string; band: string; text: string }[]>();
for (const file of walkInk()) {
  const match = AGE_BAND.exec(basename(file));
  if (!match) continue;
  const [, scene, band] = match;
  const list = perScene.get(scene) ?? [];
  list.push({ scene, band, text: extractUtterances(readInk(file)).join(' ') });
  perScene.set(scene, list);
}
const sceneStageText = new Map<string, string>();
for (const [scene, list] of perScene) {
  sceneStageText.set(scene, list.sort((a, b) => a.text.length - b.text.length)[0].text);
}

const shotlist = loadShotlist();
const sourceLabel = Object.keys(shotlist).length > 0 ? `shotlist (${Object.keys(shotlist).length} сцен)` : 'эвристика (needs_review у всех записей)';
console.log(`Источник постановки: ${sourceLabel}`);

type Ref = { scene: string; band: string; stage: Stage };

const heroUsed = new Map<string, Set<string>>();
const locUsed = new Map<string, Set<string>>();
const refs: Ref[] = [];
for (const [scene, list] of perScene) {
  const stage = deriveStage(scene, sceneStageText.get(scene) ?? '', shotlist);
  for (const { band } of list) {
    refs.push({ scene, band, stage });
    const hKey = heroFrameKey(scene, band, stage);
    const lKey = locationFrameKey(stage);
    (heroUsed.get(hKey) ?? heroUsed.set(hKey, new Set()).get(hKey)!).add(`${scene}/${band}`);
    (locUsed.get(lKey) ?? locUsed.set(lKey, new Set()).get(lKey)!).add(`${scene}/${band}`);
  }
}

export type FrameKind = 'hero' | 'location';
export type FrameEntry = {
  kind: FrameKind;
  hero?: 'lis' | 'mira' | 'tima';
  band?: string;
  location: string;
  emotion?: string;
  path: string;
  used_by: string[];
  source: 'shotlist' | 'heuristic';
  needs_review: boolean;
  verified?: boolean;
  disabled?: boolean;
  note?: string;
};
export type FrameCatalog = { version: 1; frames: Record<string, FrameEntry> };

let existing: FrameCatalog = { version: 1, frames: {} };
if (existsSync(CATALOG) && !force) {
  try {
    existing = JSON.parse(readFileSync(CATALOG, 'utf8')) as FrameCatalog;
  } catch {
    console.error(`! ${CATALOG} повреждён; запустите с --force, чтобы пересобрать с нуля (ручные правки будут потеряны)`);
    process.exit(1);
  }
}

const bandOfHero = (hero: string) => Object.entries(HERO_BY_BAND).find(([, h]) => h === hero)?.[0];
const keepManual = (prev: FrameEntry | undefined) => ({
  ...(prev?.verified !== undefined ? { verified: prev.verified } : {}),
  ...(prev?.disabled !== undefined ? { disabled: prev.disabled } : {}),
  ...(prev?.note ? { note: prev.note } : {}),
});
// needs_review берём из ТЕКУЩЕГО источника (shotlist parse ok / эвристика),
// иначе старые «true» из эвристической сборки залипают навсегда.
// verified=true (решение человека) неприкосновенен.
const prevOrNew = (prev: FrameEntry | undefined, refNeedsReview: boolean) =>
  prev?.verified ? false : refNeedsReview;

const frames: Record<string, FrameEntry> = {};
for (const [key, used] of [...heroUsed].sort()) {
  const ref = refs.find((r) => heroFrameKey(r.scene, r.band, r.stage) === key)!;
  const hero = key.split('-')[0] as 'lis' | 'mira' | 'tima';
  const band = bandOfHero(hero);
  const prev = existing.frames[key];
  frames[key] = {
    kind: 'hero',
    hero,
    band,
    location: ref.stage.location,
    emotion: ref.stage.emotion,
    path: prev?.path ?? `/art/frames/${key}.png`,
    used_by: [...used].sort(),
    source: ref.stage.source,
    needs_review: prevOrNew(prev, ref.stage.needs_review),
    ...keepManual(prev),
  };
}
for (const [key, used] of [...locUsed].sort()) {
  const ref = refs.find((r) => locationFrameKey(r.stage) === key)!;
  const prev = existing.frames[key];
  frames[key] = {
    kind: 'location',
    location: ref.stage.location,
    path: prev?.path ?? `/art/frames/${key}.png`,
    used_by: [...used].sort(),
    source: ref.stage.source,
    needs_review: prevOrNew(prev, ref.stage.needs_review),
    ...keepManual(prev),
  };
}

mkdirSync(dirname(CATALOG), { recursive: true });
writeFileSync(CATALOG, JSON.stringify({ version: 1, frames } satisfies FrameCatalog, null, 2) + '\n');

const heroCount = Object.values(frames).filter((f) => f.kind === 'hero').length;
const locCount = Object.values(frames).filter((f) => f.kind === 'location').length;
const totalUsed = Object.values(frames).reduce((acc, f) => acc + f.used_by.length, 0);
const review = Object.values(frames).filter((f) => f.needs_review && !f.verified).length;
console.log(`\n${CATALOG}: кадров ${Object.keys(frames).length} (hero ${heroCount} + loc ${locCount})`);
console.log(`покрытие: ${totalUsed} назначений на ${perScene.size} уникальных сцен × 3 линейки`);
console.log(`needs_review: ${review} — проверьте глазами (git diff data/frame-catalog.json)`);
console.log('Следующий шаг: YANDEX_API_KEY=... npx tsx scripts/yandex-art-frames.ts   (сухой расчёт цены)');
