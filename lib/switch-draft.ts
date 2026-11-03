/** Non-secret, per-tab draft for a single switch-rules exercise. */
export type SwitchDraft = { signature: string; round: number; answers: (number | null)[] };
export const SWITCH_DRAFT_PREFIX = 'gib:switch-draft:v1:';
export function switchDraftPrefix(profileId: string): string { return `${SWITCH_DRAFT_PREFIX}${encodeURIComponent(profileId)}:`; }
export function switchDraftKey(profileId: string, sessionId: string, step: number): string {
  return `${switchDraftPrefix(profileId)}${encodeURIComponent(sessionId)}:${step}`;
}
export function parseSwitchDraft(raw: string | null, signature: string, rounds: number, cards: number): SwitchDraft | null {
  if (!raw || !Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(cards) || cards < 1) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const draft = d as SwitchDraft;
    if (draft.signature !== signature || !Number.isInteger(draft.round) || draft.round < 0 || draft.round >= rounds ||
        !Array.isArray(draft.answers) || draft.answers.length !== rounds ||
        !draft.answers.every(answer => answer === null || (Number.isInteger(answer) && answer >= 0 && answer < cards)) ||
        draft.answers.slice(0, draft.round).some(answer => answer === null)) return null;
    return { signature, round: draft.round, answers: [...draft.answers] };
  } catch { return null; }
}
/** Browser storage may be unavailable; drafts never block game progress. */
export function removeProfileSwitchDrafts(storage: Storage, profileId: string): void {
  const prefix = switchDraftPrefix(profileId);
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  keys.forEach(key => storage.removeItem(key));
}
