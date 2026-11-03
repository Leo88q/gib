/**
 * Возобновление приватной части дневного цикла после перезагрузки — и только она.
 *
 * Хранится лишь то, куда ребёнок дошёл: экран подготовки и его фаза. Отметки
 * чувств, выбор передышки и ответ итога НЕ сохраняются и не отправляются — они
 * по-прежнему существуют только в памяти компонента и исчезают при перезагрузке.
 *
 * Формат защищён подписью профиля/дня, чтобы черновик вчерашнего дня не открылся
 * сегодня, и проверяется на чтении. Значения — только из закрытого списка.
 */
export type WelcomePhase = 'checkin' | 'pause';

export type JourneyResume = {
  /** Версия формата: меняется вместе со смыслом полей. */
  version: 1;
  /** Профиль и день, к которым относится черновик. */
  signature: string;
  /** Экран, на котором остановились. */
  screen: 'welcome' | 'reflection';
  /** Для экрана подготовки: открыта отметка или передышка. */
  phase?: WelcomePhase;
};

export const JOURNEY_RESUME_PREFIX = 'gib:journey-resume:v1:';

/** Ключ привязан к профилю и дню: чужая или вчерашняя запись не подхватится. */
export function journeyResumeKey(profileId: string, day: number): string {
  return `${JOURNEY_RESUME_PREFIX}${profileId}:${day}`;
}

/** Подпись задания: профиль и номер дня программы. */
export function journeySignature(profileId: string, day: number): string {
  return `${profileId}:${day}`;
}

function safeString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 120;
}

/** Возвращает только валидную запись; всё остальное считается отсутствием черновика. */
export function parseJourneyResume(raw: string | null, signature: string): JourneyResume | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.version !== 1 || data.signature !== signature) return null;
    if (data.screen !== 'welcome' && data.screen !== 'reflection') return null;
    if (data.screen === 'reflection') return { version: 1, signature, screen: 'reflection' };
    if (data.phase !== 'checkin' && data.phase !== 'pause') return null;
    return { version: 1, signature, screen: 'welcome', phase: data.phase };
  } catch {
    return null;
  }
}

export function serializeJourneyResume(resume: JourneyResume): string | null {
  if (!safeString(resume.signature)) return null;
  if (resume.screen === 'welcome') {
    if (resume.phase !== 'checkin' && resume.phase !== 'pause') return null;
    return JSON.stringify({ version: 1, signature: resume.signature, screen: 'welcome', phase: resume.phase });
  }
  return JSON.stringify({ version: 1, signature: resume.signature, screen: 'reflection' });
}
