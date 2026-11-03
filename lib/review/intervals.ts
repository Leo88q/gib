/**
 * Простые и объяснимые правила повторения.
 *
 * Почему не FSRS: FSRS обучен на запоминании карточек, а не на социальных
 * навыках; его эффективность для них не доказана, и он выдаёт «вероятность
 * вспоминания», которую легко принять за оценку ребёнка. Здесь интервалы
 * фиксированные, возрастные и намеренно осторожные.
 *
 * Правила:
 * - повтор не наказывает: пропуск не уменьшает интервал и не отменяет прогресс;
 * - для 5–7 лет интервал короче, для 11–13 — длиннее;
 * - максимальный интервал ограничен, чтобы «повторение» не превращалось
 *   в висящую вечно задачу;
 * - ребёнок видит, когда тема вернётся, и может отказаться.
 */

export type ReviewBand = '5-7' | '8-10' | '11-13';

export type ReviewState = {
  /** Тема/сценарий, к которому относится повтор. */
  topicId: string;
  band: ReviewBand;
  /** Номер прошедших повторений темы (0 — ещё ни разу не повторяли). */
  reviews: number;
  /** Когда тема в следующий раз уместна (мс), null — повтор не нужен. */
  dueAt: number | null;
  /** Сколько раз тема была пропущена; пропуск не влияет на срок, только на объяснение. */
  skipped: number;
  updatedAt: number;
};

export type ReviewOutcome = 'reviewed' | 'skipped' | 'refused';

/** Базовые интервалы в днях по возрасту: от коротких к длинным. */
const BASE_DAYS: Record<ReviewBand, number[]> = {
  '5-7': [2, 4, 7, 10],
  '8-10': [3, 6, 10, 14],
  '11-13': [4, 8, 14, 21],
};

/** Верхняя граница: дальше тему не тянем, она просто закреплена. */
export const MAX_REVIEW_DAYS = 21;

/** Предел числа повторений: после него тема считается закреплённой. */
export const MAX_REVIEWS = 4;

const DAY = 24 * 60 * 60 * 1000;

export type ReviewError = 'unknown_outcome' | 'band_mismatch' | 'invalid_state';

/**
 * Применяет результат повторения к состоянию. Функция чистая: не читает время
 * сама, не пишет в хранилище и ничего не наказывает.
 */
export function applyReview(state: ReviewState, outcome: ReviewOutcome, now: number): { ok: true; state: ReviewState } | { ok: false; error: ReviewError } {
  if (!Number.isFinite(now) || now < 0) return { ok: false, error: 'invalid_state' };
  if (!(state.band in BASE_DAYS) || !Number.isInteger(state.reviews) || state.reviews < 0) return { ok: false, error: 'invalid_state' };
  if (outcome === 'refused') {
    // Отказ — тоже ответ: тема вернётся не раньше чем через срок, но без упрёков.
    return { ok: true, state: { ...state, dueAt: null, updatedAt: now } };
  }
  if (outcome === 'skipped') {
    // Пропуск не сдвигает срок и не сбрасывает прогресс: просто отмечаем факт.
    return { ok: true, state: { ...state, skipped: state.skipped + 1, updatedAt: now } };
  }
  if (outcome !== 'reviewed') return { ok: false, error: 'unknown_outcome' };
  const reviews = state.reviews + 1;
  if (reviews >= MAX_REVIEWS) return { ok: true, state: { ...state, reviews, dueAt: null, updatedAt: now } };
  const days = Math.min(MAX_REVIEW_DAYS, BASE_DAYS[state.band][Math.min(reviews - 1, BASE_DAYS[state.band].length - 1)]);
  return { ok: true, state: { ...state, reviews, dueAt: now + days * DAY, updatedAt: now } };
}

/** Человеческое объяснение срока; не «умный» вывод о ребёнке, а расписание. */
export function describeReview(state: ReviewState, now: number): string {
  if (state.dueAt === null) {
    return state.reviews >= MAX_REVIEWS
      ? 'Тема закреплена — повторять её специально не нужно.'
      : 'Тема отложена. Вернуться к ней можно в любой момент.';
  }
  const days = Math.ceil((state.dueAt - now) / DAY);
  if (days <= 0) return 'Тему можно повторить в подходящий момент — без спешки.';
  if (days === 1) return 'Тема вернётся завтра, если будет удобно.';
  return `Тема вернётся через ${days} ${plural(days, 'день', 'дня', 'дней')}. Повтор можно пропустить.`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Темы, которые уместны сейчас; сортировка по сроку, затем по числу повторений. */
export function dueTopics(states: ReviewState[], now: number, limit = 3): ReviewState[] {
  return states
    .filter(s => s.dueAt !== null && s.dueAt <= now)
    .sort((a, b) => (a.dueAt! - b.dueAt!) || (a.reviews - b.reviews))
    .slice(0, Math.max(0, limit));
}
