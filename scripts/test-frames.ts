/**
 * Проверка каталога переиспользуемых кадров (data/frame-catalog.json).
 * Как и cinema-manifest: нормализатор не роняет приложение, валидные записи
 * сохраняются, выключенные кадры не отдаются.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeFrameCatalog, frameUrl, framesForScene, type FrameCatalog,
} from '../lib/frames.ts';

let failures = 0;
const check = (name: string, condition: boolean) => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) failures += 1;
};

const good = normalizeFrameCatalog({
  version: 1,
  frames: {
    'lis-room-calm': { kind: 'hero', hero: 'lis', band: '5-7', location: 'комната', emotion: 'спокойный', path: '/art/frames/lis-room-calm.png', used_by: ['w1d1/5-7', 'w2d4/5-7'], source: 'heuristic', needs_review: true },
    'loc-room': { kind: 'location', location: 'комната', path: '/art/frames/loc-room.png', used_by: ['w1d1/5-7'], source: 'shotlist', needs_review: false },
    'tima-room-calm': { kind: 'hero', hero: 'tima', band: '11-13', location: 'комната', path: 'frames/tima-room-calm.png', used_by: ['w1d1/11-13'], source: 'shotlist', needs_review: false }, // нет ведущего слэша
    'BROKEN KEY': { kind: 'hero', location: 'x', path: '/art/frames/x.png', used_by: [], source: 'heuristic', needs_review: false },
    'mira-park-happy': { kind: 'hero', location: 'парк', path: '/art/frames/mira-park-happy.png', used_by: ['w9d9/8-10'], source: 'shotlist', needs_review: false, disabled: true },
  },
});
check('нормализатор оставил валидные записи', Object.keys(good.frames).length === 3);
check('невалидные ключи и пути отброшены', !('BROKEN KEY' in good.frames) && !('tima-room-calm' in good.frames));
check('disabled-кадр не отдаётся по URL', frameUrl(good, 'mira-park-happy') === null);
check('обычный кадр отдаёт путь', frameUrl(good, 'lis-room-calm') === '/art/frames/lis-room-calm.png');
check('framesForScene находит hero и loc', framesForScene(good, 'w1d1', '5-7').length === 2);
check('framesForScene пустой для чужой сцены', framesForScene(good, 'w9d9', '5-7').length === 0);
check('normalize терпит мусор', normalizeFrameCatalog(null).frames && Object.keys(normalizeFrameCatalog(null).frames).length === 0);
check('normalize терпит битые used_by', framesForScene(normalizeFrameCatalog({ version: 1, frames: { 'lis-room-calm': { kind: 'hero', location: 'комната', path: '/art/frames/lis-room-calm.png', used_by: ['не сцена', 42], source: 'heuristic', needs_review: false } } }), 'w1d1', '5-7').length === 0);
check('clip-ключ регистрозависим (W1D1 не пройдёт)', SCENE_DISCARD(normalizeFrameCatalog({ version: 1, frames: { 'lis-room-calm': { kind: 'hero', location: 'к', path: '/art/frames/lis-room-calm.png', used_by: ['W1D1/5-7'], source: 'heuristic', needs_review: false } } })));
function SCENE_DISCARD(cat: FrameCatalog): boolean {
  return cat.frames['lis-room-calm']!.used_by.length === 0;
}

// Реальный каталог в репозитории
let real: FrameCatalog | null = null;
try {
  real = normalizeFrameCatalog(JSON.parse(readFileSync(join('data', 'frame-catalog.json'), 'utf8')) as unknown);
} catch { /* файла нет — проверяем ниже */ }
check('data/frame-catalog.json существует и валиден', real !== null);
if (real) {
  const entries = Object.entries(real.frames);
  check('каталог не пуст', entries.length > 0);
  check('все пути начинаются с /art/frames/', entries.every(([, f]) => f.path.startsWith('/art/frames/')));
  check('покрытие: дубликатов в used_by нет', entries.every(([, f]) => new Set(f.used_by).size === f.used_by.length));
  check('hero-кадры привязаны к своей линейке', entries.every(([key, f]) => {
    if (f.kind !== 'hero') return true;
    const heroBand = key.startsWith('lis') ? '5-7' : key.startsWith('mira') ? '8-10' : '11-13';
    return f.band === heroBand;
  }));
}

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`);
  process.exit(1);
}
console.log('\nВсе проверки кадрового каталога пройдены');
