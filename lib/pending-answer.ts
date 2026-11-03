import type { AnswerPayload } from './engine/check-answer';

export const PENDING_ANSWER_KEY = 'gib:pending-answer:v1';
export type PendingAnswer<T> = {
  profileId: string;
  sessionId: string;
  step: number;
  steps: number;
  payload: AnswerPayload;
  ms: number;
  item: T;
};

/** Session storage is untrusted and may have been written by an older app version. */
export function parsePendingAnswer<T>(raw: string | null, profileId: string): PendingAnswer<T> | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || p.profileId !== profileId || typeof p.sessionId !== 'string' || !p.sessionId ||
        !Number.isInteger(p.step) || p.step < 0 || !Number.isInteger(p.steps) || p.steps < 1 || p.step >= p.steps ||
        typeof p.ms !== 'number' || !Number.isFinite(p.ms) || p.ms < 0 ||
        !p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload) ||
        !p.item || typeof p.item !== 'object' || (p.item.type !== 'task' && p.item.type !== 'scenario')) return null;
    if (p.item.type === 'task' && (!p.item.instance || typeof p.item.instance !== 'object' || typeof p.item.instance.kind !== 'string')) return null;
    if (p.item.type === 'scenario' && (!p.item.variant || typeof p.item.variant !== 'object' || !Array.isArray(p.item.variant.options))) return null;
    return p as PendingAnswer<T>;
  } catch { return null; }
}

/** Do not erase a newer answer if the stored value changed before dismissal. */
export function clearMatchingPendingAnswer(storage: Pick<Storage, 'getItem' | 'removeItem'>, expected: Pick<PendingAnswer<unknown>, 'profileId' | 'sessionId' | 'step'>): void {
  const current = parsePendingAnswer(storage.getItem(PENDING_ANSWER_KEY), expected.profileId);
  if (current && current.sessionId === expected.sessionId && current.step === expected.step) storage.removeItem(PENDING_ANSWER_KEY);
}
