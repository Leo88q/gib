/**
 * Каталог переиспользуемых кадров: «семантический ключ → путь к файлу».
 *
 * Идея: вместо генерации уникального кадра на каждый урок один и тот же
 * отобранный кадр («Лис в мастерской, спокойный, общий план») вставляется
 * во все сцены с той же постановкой. Один источник правды —
 * data/frame-catalog.json; генерация и расстановка — scripts/yandex-art-frames.ts
 * и scripts/link-frame-stills.ts; ревью — git diff файла каталога.
 *
 * Файлы кадров кладутся в public/art/frames/<key>.png (попадают в сборку);
 * кандидаты — в out/art/frames/<key>-c<N>.png (вне git).
 *
 * Модуль изоморфен: браузер не читает файлы — компонент получает каталог
 * параметром (или с сервера). Любая ошибка → null, вызывающий код ведёт себя
 * как раньше (текущие заглушки/«мягкий объём»).
 */
export type FrameEntry = {
  kind: 'hero' | 'location';
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

const FRAME_KEY = /^(lis|mira|tima|loc)-[a-z0-9][a-z0-9-]*$/;
const SCENE_BAND = /^w\d+d\d+[a-z_0-9]*\/(5-7|8-10|11-13)$/;

/** Мини-валидатор каталога: отбрасывает битые записи, не роняя приложение. */
export function normalizeFrameCatalog(raw: unknown): FrameCatalog {
  const catalog: FrameCatalog = { version: 1, frames: {} };
  if (!raw || typeof raw !== 'object') return catalog;
  const frames = (raw as { frames?: unknown }).frames;
  if (!frames || typeof frames !== 'object') return catalog;
  for (const [key, value] of Object.entries(frames as Record<string, unknown>)) {
    if (!FRAME_KEY.test(key)) continue;
    const entry = value as Partial<FrameEntry> | null;
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind !== 'hero' && entry.kind !== 'location') continue;
    if (typeof entry.path !== 'string' || !entry.path.startsWith('/art/frames/')) continue;
    if (typeof entry.location !== 'string' || !entry.location.trim()) continue;
    if (!Array.isArray(entry.used_by)) continue;
    const usedBy = (entry.used_by as unknown[]).filter((x): x is string => typeof x === 'string' && SCENE_BAND.test(x));
    catalog.frames[key] = {
      kind: entry.kind,
      hero: entry.hero === 'lis' || entry.hero === 'mira' || entry.hero === 'tima' ? entry.hero : undefined,
      band: typeof entry.band === 'string' ? entry.band : undefined,
      location: entry.location.trim(),
      emotion: typeof entry.emotion === 'string' ? entry.emotion : undefined,
      path: entry.path,
      used_by: usedBy,
      source: entry.source === 'shotlist' ? 'shotlist' : 'heuristic',
      needs_review: Boolean(entry.needs_review),
      verified: entry.verified === true || undefined,
      disabled: entry.disabled === true || undefined,
      note: typeof entry.note === 'string' ? entry.note : undefined,
    };
  }
  return catalog;
}

/** URL кадра по ключу; нет/выключен → null. */
export function frameUrl(catalog: FrameCatalog | null, key: string): string | null {
  if (!catalog) return null;
  const entry = catalog.frames[key];
  if (!entry || entry.disabled) return null;
  return entry.path;
}

/** Кадры, назначенные сцене (hero + B-roll), без выключенных. */
export function framesForScene(catalog: FrameCatalog | null, sceneId: string, band: string): FrameEntry[] {
  if (!catalog) return [];
  const use = `${sceneId}/${band}`;
  return Object.values(catalog.frames).filter((f) => !f.disabled && f.used_by.includes(use));
}

/** Серверная загрузка каталога; любая ошибка → null. */
export async function loadFrameCatalog(): Promise<FrameCatalog | null> {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'frame-catalog.json'), 'utf8');
    return normalizeFrameCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}
