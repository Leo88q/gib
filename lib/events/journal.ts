/**
 * Каталог внутренних событий — минимальный и типизированный.
 *
 * Это НЕ xAPI: формат внутренний. У события нет свободного текста, имён,
 * initData, ответов ребёнка и отметок чувств. Псевдонимный `profileId` всё
 * равно может быть персональными данными, поэтому журнал не включается в экспорт
 * профиля и удаляется вместе с профилем.
 *
 * Событие создаётся только сервером в той же транзакции, что и изменение
 * состояния, поэтому «событие без изменения» или «изменение без события»
 * в норме не появляются.
 */

export const EVENT_VERSION = 1 as const;

export type EventProfileRef = string;

/**
 * Разрешённые типы и их технические поля. `v` — версия схемы события.
 * Всё, чего нет в этом списке, сервер не записывает.
 */
export type LearningEvent =
  | { v: 1; type: 'session_started'; dayIndex: number; repeat: boolean; journey: boolean }
  | { v: 1; type: 'story_selected'; cardId: string; offerSize: number }
  | { v: 1; type: 'story_answered'; choiceIndex: number; itemCount: number }
  | { v: 1; type: 'practice_answered'; skipped: boolean }
  | { v: 1; type: 'task_answered'; taskKind: string; correct: boolean; assisted: boolean; ms: number }
  | { v: 1; type: 'session_completed'; steps: number; correct: number; stars: number; seconds: number }
  | { v: 1; type: 'profile_created'; band: '5-7' | '8-10' | '11-13' }
  | { v: 1; type: 'profile_deleted'; reason: 'user_request' };

export type EventType = LearningEvent['type'];

export type StoredEvent = {
  /** Случайный идентификатор; не выводится из профиля или времени. */
  id: string;
  profileId: EventProfileRef;
  /** Владелец профиля: событие нельзя прочитать или подделать из чужой сессии. */
  ownerId: string;
  /** Время сервера, мс. Клиентское время не принимается. */
  at: number;
  /** Ключ идемпотентности: один и тот же шаг не создаёт второе событие. */
  dedupeKey: string;
  event: LearningEvent;
};

export type EventError = 'invalid_event' | 'unknown_type' | 'invalid_field' | 'too_long' | 'duplicate_key';

const MAX_STRING = 80;

/** Только эти поля допускаются для каждого типа. */
const ALLOWED: Record<EventType, readonly string[]> = {
  session_started: ['dayIndex', 'repeat', 'journey'],
  story_selected: ['cardId', 'offerSize'],
  story_answered: ['choiceIndex', 'itemCount'],
  practice_answered: ['skipped'],
  task_answered: ['taskKind', 'correct', 'assisted', 'ms'],
  session_completed: ['steps', 'correct', 'stars', 'seconds'],
  profile_created: ['band'],
  profile_deleted: ['reason'],
};

/**
 * Диапазоны задаются парой «тип.поле»: одно и то же имя может значить разное
 * (`task_answered.correct` — флаг, `session_completed.correct` — счётчик).
 */
const NUMERIC_RANGES: Record<string, [number, number]> = {
  'session_started.dayIndex': [0, 59],
  'story_selected.offerSize': [1, 10],
  'story_answered.choiceIndex': [0, 9],
  'story_answered.itemCount': [1, 20],
  'task_answered.ms': [0, 600_000],
  'session_completed.steps': [0, 20],
  'session_completed.correct': [0, 20],
  'session_completed.stars': [0, 3],
  'session_completed.seconds': [0, 86_400],
};

/** Пользовательские строки (например, тема задания) не должны попадать в журнал. */
function safeString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING && pattern.test(value);
}

/**
 * Проверяет событие, пришедшее от кода (не от клиента) и возвращает
 * нормализованную копию либо причину отказа. Ошибка не бросается:
 * вызывающий решает, прервать ли операцию.
 */
export function validateEvent(input: unknown): { ok: true; event: LearningEvent } | { ok: false; error: EventError } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_event' };
  const raw = input as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== 'string' || !(type in ALLOWED)) return { ok: false, error: 'unknown_type' };
  const allowed = ALLOWED[type as EventType];
  // Лишние поля — ошибка, а не молчаливое отбрасывание: так утечка видна сразу.
  if (Object.keys(raw).some(key => !['v', 'type'].includes(key) && !allowed.includes(key))) return { ok: false, error: 'invalid_field' };
  if (raw.v !== EVENT_VERSION) return { ok: false, error: 'invalid_field' };
  const event: Record<string, unknown> = { v: EVENT_VERSION, type };
  for (const field of allowed) {
    const value = raw[field];
    if (value === undefined) return { ok: false, error: 'invalid_field' };
    const range = NUMERIC_RANGES[`${type}.${field}`];
    if (range) {
      const [min, max] = range;
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) return { ok: false, error: 'invalid_field' };
      event[field] = value;
    } else if (field === 'band') {
      if (value !== '5-7' && value !== '8-10' && value !== '11-13') return { ok: false, error: 'invalid_field' };
      event[field] = value;
    } else if (field === 'reason') {
      if (value !== 'user_request') return { ok: false, error: 'invalid_field' };
      event[field] = value;
    } else if (field === 'taskKind') {
      if (!safeString(value, /^[a-z][a-z-]{1,40}$/)) return { ok: false, error: 'invalid_field' };
      event[field] = value;
    } else if (field === 'cardId') {
      if (!safeString(value, /^[a-zA-Z0-9_-]{1,80}$/)) return { ok: false, error: 'invalid_field' };
      event[field] = value;
    } else {
      if (typeof value !== 'boolean') return { ok: false, error: 'invalid_field' };
      event[field] = value;
    }
  }
  return { ok: true, event: event as LearningEvent };
}

/** Ключ идемпотентности: сессия, шаг и суть действия. Без времени и идентификатора ребёнка. */
export function dedupeKeyFor(sessionId: string, step: number, kind: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionId) || !Number.isInteger(step) || step < 0) return '';
  return `${sessionId}:${step}:${kind}`;
}

/**
 * Журнал в памяти процесса. Отдельного хранилища и API пока нет:
 * это делает возможным тестирование контракта, но не считается
 * production-интеграцией и не отправляет данные наружу.
 */
export type EventJournal = {
  append(ownerId: string, profileId: string, dedupeKey: string, event: LearningEvent, at?: number): { ok: true; stored: StoredEvent } | { ok: false; error: EventError };
  list(ownerId: string, profileId: string): StoredEvent[];
  removeProfile(profileId: string): number;
  size(): number;
  /** Тестовая дедупликация: повтор с тем же ключом возвращает исходное событие. */
  lastError(): EventError | null;
};

export function createEventJournal(limit = 5000): EventJournal {
  const events: StoredEvent[] = [];
  const byKey = new Map<string, StoredEvent>();
  let lastError: EventError | null = null;
  let counter = 0;
  return {
    append(ownerId, profileId, dedupeKey, event, at = Date.now()) {
      const checked = validateEvent(event);
      if (!checked.ok) { lastError = checked.error; return { ok: false, error: checked.error }; }
      // Ключ содержит разделители «:», поэтому шаблон допускает их, но запрещает пробелы.
      if (!/^[a-zA-Z0-9_:-]{1,120}$/.test(dedupeKey)) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      const existing = byKey.get(dedupeKey);
      if (existing) {
        // Повтор того же шага не создаёт второе событие; чужая подмена отклоняется.
        if (existing.profileId !== profileId || existing.ownerId !== ownerId) { lastError = 'duplicate_key'; return { ok: false, error: 'duplicate_key' }; }
        return { ok: true, stored: existing };
      }
      if (events.length >= limit) { lastError = 'too_long'; return { ok: false, error: 'too_long' }; }
      const stored: StoredEvent = { id: `e_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 10)}`, profileId, ownerId, at, dedupeKey, event: checked.event };
      events.push(stored);
      byKey.set(dedupeKey, stored);
      lastError = null;
      return { ok: true, stored };
    },
    list(ownerId, profileId) {
      // Чужой владелец не видит ничего, даже при совпадении profileId.
      return events.filter(e => e.ownerId === ownerId && e.profileId === profileId);
    },
    removeProfile(profileId) {
      const before = events.length;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].profileId === profileId) { byKey.delete(events[i].dedupeKey); events.splice(i, 1); }
      }
      return before - events.length;
    },
    size: () => events.length,
    lastError: () => lastError,
  };
}

/** Единственный журнал процесса; тесты создают собственные экземпляры. */
export const eventJournal = createEventJournal();
