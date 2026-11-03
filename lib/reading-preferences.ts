export type ReadingPreferences = { font: 'standard' | 'opendyslexic'; largeText: boolean; reduceMotion: boolean };
export const READING_KEY = 'gib:reading-preferences:v1';
export const READING_EVENT = 'gib:reading-preferences';
export const DEFAULT_READING: ReadingPreferences = { font: 'standard', largeText: false, reduceMotion: false };
export function parseReadingPreferences(raw: string | null): ReadingPreferences {
  if (!raw) return { ...DEFAULT_READING };
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ...DEFAULT_READING };
    return { font: p.font === 'opendyslexic' ? 'opendyslexic' : 'standard', largeText: p.largeText === true, reduceMotion: p.reduceMotion === true };
  } catch { return { ...DEFAULT_READING }; }
}
export function shouldReduceMotion(preference: boolean, system: boolean): boolean { return preference || system; }
export function readReadingPreferences(): ReadingPreferences {
  try { return parseReadingPreferences(localStorage.getItem(READING_KEY)); } catch { return { ...DEFAULT_READING }; }
}
export function applyReadingPreferences(p: ReadingPreferences): void {
  document.documentElement.dataset.readingFont = p.font;
  document.documentElement.dataset.largeText = String(p.largeText);
  document.documentElement.dataset.reduceMotion = String(p.reduceMotion);
}
/** Returns false if persistence is unavailable. In-memory changes are still applied. */
export function saveReadingPreferences(p: ReadingPreferences): boolean {
  applyReadingPreferences(p);
  let saved = false;
  try { localStorage.setItem(READING_KEY, JSON.stringify(p)); saved = true; } catch { /* settings work until reload */ }
  window.dispatchEvent(new CustomEvent(READING_EVENT, { detail: p }));
  return saved;
}
