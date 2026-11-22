/**
 * Нормализация data/storyboards.json (0 ₽): единый формат bands[band] = Frame[],
 * пересчёт needs_review и stats. Исходник — предыдущая версия файла в git.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readInk, walkInk } from './yandex-api.ts';
import { basename } from 'node:path';
import { normalizeStoryboard, type StoryboardRecord } from './storyboard-schema.ts';

const FILE = 'data/storyboards.json';
const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(\d+-\d+)\.ink$/;
const sceneSource = new Map<string, string>();
for (const file of walkInk()) {
  const match = AGE_BAND.exec(basename(file));
  if (!match || sceneSource.has(match[1])) continue;
  sceneSource.set(match[1], file);
}
const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;
const out: Record<string, StoryboardRecord> = {};
const summary = { scenes: 0, frames_total: 0, low: [] as string[], verbatim_miss_total: 0, empty_replicas_total: 0 };
for (const [scene, record] of Object.entries(raw)) {
  const src = sceneSource.get(scene);
  const sourceText = src ? readInk(src) : '';
  const norm = normalizeStoryboard(record, sourceText, src ? basename(src) : undefined);
  out[scene] = norm;
  summary.scenes++;
  summary.frames_total += norm.stats.frames_total;
  summary.empty_replicas_total += norm.stats.empty_replicas;
  summary.verbatim_miss_total += norm.stats.verbatim_miss;
  if (norm.needs_review) summary.low.push(scene);
}
writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`storyboards: нормализовано ${summary.scenes} сцен, кадров ${summary.frames_total}`);
console.log(`реплики: пустых ${summary.empty_replicas_total}, НЕ дословные ${summary.verbatim_miss_total}`);
console.log(`needs_review: ${summary.low.length}/${summary.scenes} (валидно по шкале: schema OK + ≥6 кадров на линейку + все реплики дословно)`);
