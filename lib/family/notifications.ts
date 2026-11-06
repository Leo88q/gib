/**
 * Уведомления взрослому.
 *
 * Правила:
 *  — по умолчанию уведомлений нет: согласие не предполагается;
 *  — без явного согласия отчёт не отправляется даже по нажатию кнопки;
 *  — частота ограничена сервером, а не только текстом: повторная отправка
 *    раньше срока отклоняется с честным «сколько осталось»;
 *  — отзыв согласия выключает отправку и сбрасывает счётчик, чтобы после
 *    повторного включения нельзя было сразу получить отчёт заново.
 *
 * Это только настройка отправки отчёта взрослому. Сообщения ребёнку,
 * напоминания и рассылки сюда не относятся и не реализованы.
 */

export type NotificationFrequency = 'off' | 'weekly' | 'monthly';

export type NotificationSettings = {
  enabled: boolean;
  frequency: NotificationFrequency;
  /** Когда последний раз реально отправляли отчёт (мс). */
  lastSentAt: number | null;
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: false, frequency: 'off', lastSentAt: null };

/** Минимальные интервалы: неделя и месяц. Чаще — нельзя, даже если очень хочется. */
export const FREQUENCY_MS: Record<Exclude<NotificationFrequency, 'off'>, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export const FREQUENCY_LABELS: Record<NotificationFrequency, string> = {
  off: 'Не отправлять',
  weekly: 'Раз в неделю',
  monthly: 'Раз в месяц',
};

export function validFrequency(value: unknown): value is NotificationFrequency {
  return value === 'off' || value === 'weekly' || value === 'monthly';
}

export function validSettings(value: unknown): value is NotificationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'enabled,frequency,lastSentAt') return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (!validFrequency(v.frequency)) return false;
  if (v.lastSentAt !== null && !(typeof v.lastSentAt === 'number' && Number.isFinite(v.lastSentAt) && v.lastSentAt >= 0)) return false;
  // Включено — значит выбрана частота; выключено — значит только 'off'.
  return v.enabled ? v.frequency !== 'off' : v.frequency === 'off';
}

export type SendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'consent_required' | 'disabled' | 'too_soon'; retryAfterMs?: number };

/**
 * Можно ли отправить отчёт сейчас.
 *
 * `consent` — отдельное согласие взрослого; `settings.enabled` — выключатель.
 * Оба должны быть включены, иначе отправки нет.
 */
export function canSend(settings: NotificationSettings | undefined, consent: boolean, now = Date.now()): SendDecision {
  if (!consent) return { allowed: false, reason: 'consent_required' };
  if (!settings || !settings.enabled || settings.frequency === 'off') return { allowed: false, reason: 'disabled' };
  const gap = FREQUENCY_MS[settings.frequency];
  const last = settings.lastSentAt;
  if (typeof last === 'number' && Number.isFinite(last) && now - last < gap) {
    return { allowed: false, reason: 'too_soon', retryAfterMs: gap - (now - last) };
  }
  return { allowed: true };
}

/** Человеческий текст «сколько ждать» без давления. */
export function waitText(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} ч.`;
  return `${Math.ceil(hours / 24)} дн.`;
}
