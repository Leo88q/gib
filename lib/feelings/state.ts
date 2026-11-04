import type { AgeBand } from '../types';
import { FEELINGS, type FeelingId } from '../content/feelings-checkin.ts';

/**
 * Добровольное сохранение отметок чувств.
 *
 * Требования, которым обязана удовлетворять эта модель:
 * - сохранять можно только после явного согласия взрослого — без него API отказывает;
 * - ребёнок всегда может пропустить, снять отметки или удалить их позже;
 * - храним минимум: идентификаторы чувств, день и время, без свободного текста,
 *   без оценок и без связи с игровыми наградами;
 * - срок хранения ограничен, и это видно в данных (`days`), а не только в тексте;
 * - отметки не попадают в журнал событий и в игровые расчёты.
 *
 * Это техническая реализация. Юридические основания, сроки хранения и доступ
 * родителя к содержимому проверяет профильный юрист — до этого реальные данные
 * детей сохранять нельзя.
 */

/** Максимум отметок на профиль: защита от разрастания данных и от «дневника по привычке». */
export const MAX_CHECKINS = 60;
/** Сколько дней хранится одна отметка. Меньше — лучше, но нужно обсудить с юристом. */
export const CHECKIN_RETENTION_DAYS = 90;
/** Сколько чувств можно отметить за один раз. */
export const MAX_FEELINGS_PER_CHECKIN = 3;

const FEELING_IDS = new Set<string>(FEELINGS.map(f => f.id));
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type FeelingCheckIn = {
  id: string;
  /** Календарный день профиля `YYYY-MM-DD`: точное время события не нужно. */
  day: string;
  /** Отмеченные чувства, без повторов. */
  feelings: FeelingId[];
  /** Когда сохранено (для срока хранения). */
  at: number;
};

export type FeelingsPreferences = {
  /** Согласие взрослого на сохранение отметок. По умолчанию его нет. */
  saveEnabled: boolean;
  /** Когда согласие было дано или отозвано — без этого нельзя доказать согласие. */
  consentAt?: number;
  band: AgeBand;
};

export const emptyFeelingsPreferences = (band: AgeBand): FeelingsPreferences => ({ saveEnabled: false, band });

/** Проверка сохранённого состояния: только известные поля и значения. */
export function validCheckIn(value: unknown): value is FeelingCheckIn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort().join(',');
  if (keys !== 'at,day,feelings,id') return false;
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(item.id)) return false;
  if (typeof item.day !== 'string' || !DAY_PATTERN.test(item.day)) return false;
  if (typeof item.at !== 'number' || !Number.isFinite(item.at) || item.at <= 0) return false;
  if (!Array.isArray(item.feelings) || item.feelings.length === 0 || item.feelings.length > MAX_FEELINGS_PER_CHECKIN) return false;
  if (!item.feelings.every(f => typeof f === 'string' && FEELING_IDS.has(f))) return false;
  return new Set(item.feelings).size === item.feelings.length;
}

export function validPreferences(value: unknown): value is FeelingsPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.saveEnabled !== 'boolean') return false;
  if (!['5-7', '8-10', '11-13'].includes(String(item.band))) return false;
  if (item.consentAt !== undefined && (typeof item.consentAt !== 'number' || !Number.isFinite(item.consentAt) || item.consentAt <= 0)) return false;
  const allowed = ['saveEnabled', 'band', 'consentAt'];
  return Object.keys(item).every(key => allowed.includes(key));
}

/**
 * Мусор из запроса не должен превращаться в сохранённую отметку.
 * Возвращает очищенный набор чувств или null, если сохранять нечего.
 */
export function sanitizeFeelings(value: unknown): FeelingId[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const cleaned: FeelingId[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !FEELING_IDS.has(raw)) return null;
    if (!cleaned.includes(raw as FeelingId)) cleaned.push(raw as FeelingId);
  }
  if (cleaned.length > MAX_FEELINGS_PER_CHECKIN) return null;
  return cleaned;
}

/**
 * Срок хранения: старые отметки удаляются при каждом обращении.
 * Функция чистая, чтобы её было легко проверить.
 */
export function pruneCheckIns(
  items: readonly FeelingCheckIn[],
  now: number,
  retentionDays = CHECKIN_RETENTION_DAYS,
): FeelingCheckIn[] {
  const cutoff = now - retentionDays * 86_400_000;
  return items.filter(item => item.at >= cutoff);
}

/**
 * Добавляет отметку с ограничением по количеству.
 * Самая старая вытесняется: ребёнок не получает сообщений «место кончилось».
 */
export function addCheckIn(
  items: readonly FeelingCheckIn[],
  next: FeelingCheckIn,
  limit = MAX_CHECKINS,
): FeelingCheckIn[] {
  if (!validCheckIn(next)) return [...items];
  const merged = [...items, next];
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/** Удаление: по одной отметке или всех сразу. */
export function removeCheckIn(items: readonly FeelingCheckIn[], id: string): FeelingCheckIn[] {
  return items.filter(item => item.id !== id);
}

/**
 * Что можно показать ребёнку: только его же отметки, без подписей и советов.
 * Никаких выводов «тебе грустно третий день» — это интерпретация, а не факт.
 */
export function publicCheckIns(items: readonly FeelingCheckIn[]): { id: string; day: string; feelings: FeelingId[] }[] {
  return items.map(item => ({ id: item.id, day: item.day, feelings: [...item.feelings] }));
}
