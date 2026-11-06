/**
 * Черновик одного упражнения в пределах вкладки: одиночный выбор и ввод цифр.
 *
 * Здесь нет ключей ответа, наград и оценок. Черновик нужен только чтобы
 * ребёнок не начинал заново после случайной перезагрузки. Он не отправляется
 * на сервер и не заменяет серверную проверку ответа.
 */

export const EXERCISE_DRAFT_PREFIX = 'gib:exercise-draft:v1:';
export type ExerciseSlot = 'single' | 'digits';

export function exerciseDraftPrefix(profileId: string): string {
  return `${EXERCISE_DRAFT_PREFIX}${encodeURIComponent(profileId)}:`;
}

export function exerciseDraftKey(profileId: string, sessionId: string, step: number, slot: ExerciseSlot): string {
  return `${exerciseDraftPrefix(profileId)}${encodeURIComponent(sessionId)}:${encodeURIComponent(String(step))}:${slot}`;
}

export type SingleDraft = { signature: string; pick: number | null };

/** Одиночный выбор: индекс в допустимых границах либо пустое значение. */
export function parseSingleDraft(raw: string | null, signature: string, count: number): SingleDraft | null {
  if (!raw || !Number.isInteger(count) || count < 1) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const draft = d as SingleDraft;
    if (draft.signature !== signature) return null;
    if (draft.pick !== null && !(Number.isInteger(draft.pick) && draft.pick >= 0 && draft.pick < count)) return null;
    return { signature, pick: draft.pick };
  } catch {
    return null;
  }
}

export type DigitsDraft = { signature: string; digits: string };

/** Ввод цифр: только цифры, ограниченная длина, тот же набор, что примет сервер. */
export function parseDigitsDraft(raw: string | null, signature: string, length: number): DigitsDraft | null {
  if (!raw || !Number.isInteger(length) || length < 1 || length > 6) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const draft = d as DigitsDraft;
    if (draft.signature !== signature || typeof draft.digits !== 'string' || draft.digits.length > length) return null;
    if (!/^\d*$/.test(draft.digits)) return null;
    return { signature, digits: draft.digits };
  } catch {
    return null;
  }
}

/** Очистка при удалении профиля или выходе из аккаунта. */
export function removeProfileExerciseDrafts(storage: Storage, profileId: string): void {
  const prefix = exerciseDraftPrefix(profileId);
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  keys.forEach(key => storage.removeItem(key));
}
