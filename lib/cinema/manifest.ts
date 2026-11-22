/**
 * Кинематографичный режим историй («видео-прохождение»).
 *
 * Что это: короткий вертикальный ролик-вступление к сцене (Ken Burns-анимация
 * отобранного кадра пилота + закадровый голос alena), после которого поверх
 * кадра проступают выборы — там же, где в обычном режиме текстовая сцена.
 * По выбору клиент ведёт себя точно так же, как ScenarioView: та же payload,
 * то же /api/session. Сервер не меняется ни на строку.
 *
 * Что это НЕ: настоящая AI-видеозаставка на каждый узел диалога. Это было бы
 * сотни генераций, плывущие лица и бюджет выше остатка гранта. Кино-v1 —
 * «оживший» отобранный кадр; настоящая генерация видео — осознанное
 * решение после релиза, см. docs/cinema.md.
 *
 * Правила безопасности:
 *  - флаг только NEXT_PUBLIC_CINEMA_STORY=1, по умолчанию выключено;
 *  - prefers-reduced-motion → всегда обычный текстовый режим;
 *  - любой сбой загрузки ролика/манифеста → обычный ScenarioView без ошибок;
 *  - ролик всегда можно пропустить («Пропустить →», клавиатура и скринридер).
 */
export type CinemaEntry = {
  /** Путь к вертикальному intro-ролику, например /art/video/w1d1/5-7/intro.mp4 (или out-путь после сборки). */
  intro: string;
  /** Постер (первый кадр), например /art/video/w1d1/5-7/intro.jpg */
  poster?: string;
};

export type CinemaManifest = {
  version: 1;
  /** Ключ: `${scenarioId}/${band}`, например 'w1d1/5-7'. */
  entries: Record<string, CinemaEntry>;
};

export const CINEMA_MANIFEST_URL = '/cinema/manifest.json';

/** Ключ сцены: один ролик на связку сценарий × линейка. */
export function cinemaKey(scenarioId: string, band: string): string {
  return `${scenarioId}/${band}`;
}

/** Мини-валидатор манифеста: отбрасывает битые записи, не роняя режим. */
export function normalizeManifest(raw: unknown): CinemaManifest {
  const manifest: CinemaManifest = { version: 1, entries: {} };
  if (!raw || typeof raw !== 'object') return manifest;
  const entries = (raw as { entries?: unknown }).entries;
  if (!entries || typeof entries !== 'object') return manifest;
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (!/^w\d+d\d+[a-z_0-9]*\/(5-7|8-10|11-13)$/.test(key)) continue;
    const entry = value as Partial<CinemaEntry> | null;
    if (!entry || typeof entry.intro !== 'string' || !entry.intro.startsWith('/')) continue;
    manifest.entries[key] = {
      intro: entry.intro,
      poster: typeof entry.poster === 'string' && entry.poster.startsWith('/') ? entry.poster : undefined,
    };
  }
  return manifest;
}

/** Клиентский кэш манифеста: один fetch за сессию вкладки. */
let cache: Promise<CinemaManifest | null> | null = null;

export function loadCinemaManifest(): Promise<CinemaManifest | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!cache) {
    cache = fetch(CINEMA_MANIFEST_URL, { cache: 'force-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => normalizeManifest(json))
      .catch(() => null);
  }
  return cache;
}

export function clipFor(manifest: CinemaManifest | null, scenarioId: string, band: string): CinemaEntry | null {
  if (!manifest) return null;
  return manifest.entries[cinemaKey(scenarioId, band)] ?? null;
}

/** For tests and the build script. */
export function resetCinemaCacheForTests(): void {
  cache = null;
}
