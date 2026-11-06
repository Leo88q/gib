import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Роли внутри одного аккаунта взрослого.
 *
 * Сейчас детский экран и кабинет работают с одного аккаунта платформы, поэтому
 * система не может отличить ребёнка от взрослого. Это главное ограничение
 * раздела Г: подтверждение семейной идеи, согласие на сохранение чувств и отчёт
 * открыты любому, кто держит телефон.
 *
 * PIN взрослого закрывает эту дыру на уровне продукта: вход в кабинет требует
 * отдельного кода, который знает только взрослый. Это не заменяет настоящую
 * аутентификацию платформы и не проверяет личность — но ребёнок больше не
 * попадает в кабинет случайно.
 *
 * Хранение: только scrypt-хеш и соль (32 байта), сам PIN не сохраняется.
 * Сравнение хешей постоянное по времени.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
/** Слишком много попыток — пауза: 4-значный PIN иначе подбирается за минуты. */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60_000;

export type ParentPin = {
  /** Соль в hex. */
  salt: string;
  /** scrypt-хеш в hex. */
  hash: string;
  createdAt: number;
  /** Сколько неудачных попыток подряд (сбрасывается успехом). */
  failed: number;
  /** До какого времени вход заблокирован после серии неудач. */
  lockedUntil?: number;
};

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: 'no_pin' | 'invalid' | 'locked'; retryAfterMs?: number };

/** PIN из одних цифр: ребёнку проще продиктовать, взрослому — не перепутать. */
export function validPin(pin: unknown): pin is string {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/**
 * Слабые PIN отклоняются: 1111, 1234, 0000 и повторы — самые частые.
 * Это не «сложность пароля», а защита от очевидных попыток ребёнка.
 */
export function weakPin(pin: string): boolean {
  if (new Set(pin).size === 1) return true;
  const digits = pin.split('').map(Number);
  const ascending = digits.every((n, i) => i === 0 || n === digits[i - 1] + 1);
  const descending = digits.every((n, i) => i === 0 || n === digits[i - 1] - 1);
  return ascending || descending;
}

export function hashPin(pin: string, salt = randomBytes(16).toString('hex')): ParentPin {
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return { salt, hash, createdAt: Date.now(), failed: 0 };
}

export function validParentPin(value: unknown): value is ParentPin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = ['salt', 'hash', 'createdAt', 'failed', 'lockedUntil'];
  if (Object.keys(item).some(key => !allowed.includes(key))) return false;
  if (typeof item.salt !== 'string' || !/^[0-9a-f]{16,64}$/.test(item.salt)) return false;
  if (typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash)) return false;
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt <= 0) return false;
  if (typeof item.failed !== 'number' || !Number.isInteger(item.failed) || item.failed < 0) return false;
  if (item.lockedUntil !== undefined && (typeof item.lockedUntil !== 'number' || !Number.isFinite(item.lockedUntil))) return false;
  return true;
}

/**
 * Проверка PIN с защитой от подбора.
 * Возвращает и обновлённое состояние: неудачные попытки нужно сохранить.
 */
export function checkPin(stored: ParentPin, pin: unknown, now = Date.now()): { result: PinCheck; next: ParentPin } {
  if (stored.lockedUntil && stored.lockedUntil > now) {
    return { result: { ok: false, reason: 'locked', retryAfterMs: stored.lockedUntil - now }, next: stored };
  }
  const base: ParentPin = { ...stored };
  if (base.lockedUntil !== undefined) { delete base.lockedUntil; base.failed = 0; }
  if (!validPin(pin)) {
    const failed = base.failed + 1;
    return { result: { ok: false, reason: 'invalid' }, next: withAttempts(base, failed, now) };
  }
  const candidate = scryptSync(pin, base.salt, 32);
  const expected = Buffer.from(base.hash, 'hex');
  const same = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  if (!same) {
    const failed = base.failed + 1;
    return { result: { ok: false, reason: 'invalid' }, next: withAttempts(base, failed, now) };
  }
  return { result: { ok: true }, next: { ...base, failed: 0 } };
}

function withAttempts(pin: ParentPin, failed: number, now: number): ParentPin {
  if (failed >= MAX_PIN_ATTEMPTS) return { ...pin, failed: 0, lockedUntil: now + PIN_LOCK_MS };
  return { ...pin, failed };
}

/**
 * Разрешение на вход в кабинет. Короткое окно: PIN спрашивается заново после
 * паузы, чтобы «открыл кабинет один раз» не превращалось в постоянный доступ
 * с телефона, который лежит рядом с ребёнком.
 */
export const PARENT_SESSION_MS = 30 * 60_000;
export type ParentSession = { until: number };
export function validParentSession(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const until = (value as Record<string, unknown>).until;
  return typeof until === 'number' && Number.isFinite(until) && until > now;
}
