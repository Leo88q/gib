/**
 * FMV-режим «Занавес» — манифест v2 (независимый от v1 `./manifest`).
 *
 * v1 остаётся как есть: один intro-ролик на связку `scenarioId/band`.
 * v2 описывает «интерактивное кино»: порядок слоёв и сегментов на сцену.
 * Сервер не меняется ни на строку — выбор после сегментов уходит теми же
 * ответами в /api/session, как в текстовом режиме.
 *
 * Слои (z-order): set (плейт сцена, loop) → character (персонажи-биты) →
 * zlata (живой ведущий в ключе) → window (окна-слайды, HTML-слой поверх).
 * Альфа у character/zlata: HEVC-alpha .mov (Safari/WKWebView) и/или
 * VP9-alpha .webm (Chrome/Android/Desktop) — оба пути в `src`, выбор по
 * `canPlayType` на клиенте (см. `pickFmvSource`). `mp4` — последний запас:
 * без альфы годится только для set-плита и окон.
 *
 * Точка «переиграть»: `replayFrom` — id сегмента, к которому плеер перематывает
 * по кнопке «переиграть сцену». На сервер ничего не уходит — это не новый ответ
 * ребёнка, а повтор демонстрации. Награда прежняя (решение владельца).
 *
 * Правила нормализации (битые данные не роняют режим — fail-soft как в v1):
 *  - ключ сцены тот же формат, что в v1: `<scenarioId>/<band>`;
 *  - сегмент без единого пригодного пути (hevc/vp9/mp4 с ведущим `/`) отбрасывается;
 *  - дубликаты id сегментов: первый выигрывает;
 *  - запись без единого валидного сегмента отбрасывается целиком;
 *  - `replayFrom`, ссылающийся на несуществующий сегмент, обнуляется.
 */
export type FmvLayerKind = 'set' | 'character' | 'zlata' | 'window';
export type FmvSourceKind = 'hevc' | 'vp9' | 'mp4';
export type FmvSource = { hevc?: string; vp9?: string; mp4?: string };
export type FmvSegment = {
  id: string;
  layer: FmvLayerKind;
  src: FmvSource;
  /** Длительность в секундах (опционально; плеер слушает 'ended'). */
  duration?: number;
};
export type FmvEntry = {
  poster?: string;
  segments: FmvSegment[];
  replayFrom?: string;
};
export type FmvManifest = { version: 2; entries: Record<string, FmvEntry> };

/** Фиксированный порядок слоёв снизу вверх. */
export const FMV_LAYER_ORDER: readonly FmvLayerKind[] = ['set', 'character', 'zlata', 'window'];

const KEY_RE = /^w\d+d\d+[a-z_0-9]*\/(5-7|8-10|11-13)$/;
const SEGMENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const LAYERS: readonly FmvLayerKind[] = ['set', 'character', 'zlata', 'window'];

const isUsablePath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !/[\u0000-\u001f]/.test(value);

function normalizeSource(raw: unknown): FmvSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const src: FmvSource = {};
  if (isUsablePath(input.hevc)) src.hevc = input.hevc;
  if (isUsablePath(input.vp9)) src.vp9 = input.vp9;
  if (isUsablePath(input.mp4)) src.mp4 = input.mp4;
  return src.hevc || src.vp9 || src.mp4 ? src : null;
}

function normalizeSegment(raw: unknown, seen: Set<string>): FmvSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.id !== 'string' || !SEGMENT_ID_RE.test(input.id)) return null;
  if (seen.has(input.id)) return null;
  const layer = input.layer as FmvLayerKind;
  if (!LAYERS.includes(layer)) return null;
  const src = normalizeSource(input.src);
  if (!src) return null;
  const segment: FmvSegment = { id: input.id, layer, src };
  if (typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0 && input.duration <= 3600) {
    segment.duration = input.duration;
  }
  seen.add(segment.id);
  return segment;
}

export function normalizeManifestV2(raw: unknown): FmvManifest {
  const manifest: FmvManifest = { version: 2, entries: {} };
  if (!raw || typeof raw !== 'object') return manifest;
  const entries = (raw as { entries?: unknown }).entries;
  if (!entries || typeof entries !== 'object') return manifest;
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (!KEY_RE.test(key)) continue;
    const entry = value as Partial<FmvEntry> | null;
    if (!entry || typeof entry !== 'object') continue;
    const rawSegments = Array.isArray(entry.segments) ? entry.segments : [];
    const seen = new Set<string>();
    const segments = rawSegments
      .map((seg) => normalizeSegment(seg, seen))
      .filter((seg): seg is FmvSegment => seg !== null);
    if (segments.length === 0) continue;
    // Стабильный z-порядок: set → character → zlata → window, внутри слоя — порядок файла.
    segments.sort((a, b) => FMV_LAYER_ORDER.indexOf(a.layer) - FMV_LAYER_ORDER.indexOf(b.layer));
    const normalized: FmvEntry = { segments };
    if (isUsablePath(entry.poster)) normalized.poster = entry.poster;
    if (typeof entry.replayFrom === 'string' && segments.some((seg) => seg.id === entry.replayFrom)) {
      normalized.replayFrom = entry.replayFrom;
    }
    manifest.entries[key] = normalized;
  }
  return manifest;
}

/** Аналог v1 `clipFor`: запись по связке сценарий × линейка. */
export function fmvFor(manifest: FmvManifest | null, scenarioId: string, band: string): FmvEntry | null {
  if (!manifest) return null;
  return manifest.entries[`${scenarioId}/${band}`] ?? null;
}

/**
 * Выбор файла на клиенте: HEVC-alpha → VP9-alpha → mp4 (без альфы, последний запас).
 * `canPlay` — обёртка над `video.canPlayType`, в тестах — таблица.
 */
export function pickFmvSource(
  src: FmvSource,
  canPlay: (kind: FmvSourceKind) => boolean,
): { kind: FmvSourceKind; url: string } | null {
  if (src.hevc && canPlay('hevc')) return { kind: 'hevc', url: src.hevc };
  if (src.vp9 && canPlay('vp9')) return { kind: 'vp9', url: src.vp9 };
  if (src.mp4 && canPlay('mp4')) return { kind: 'mp4', url: src.mp4 };
  return null;
}
