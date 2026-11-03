/** Untrusted, per-tab selections for non-memory tasks. */
export const SELECTION_DRAFT_PREFIX = 'gib:selection-draft:v1:';
export const selectionDraftPrefix = (profileId: string) => `${SELECTION_DRAFT_PREFIX}${encodeURIComponent(profileId)}:`;
export const selectionDraftKey = (profileId: string, sessionId: string, step: number) => `${selectionDraftPrefix(profileId)}${encodeURIComponent(sessionId)}:${step}`;
export type SelectionDraft = { signature: string; picked: number[] };
export function parseSelectionDraft(raw: string | null, signature: string, count: number): SelectionDraft | null {
  if (!raw || !Number.isInteger(count) || count < 1) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.signature !== signature || !Array.isArray(d.picked) || d.picked.length > count ||
        !d.picked.every((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < count) || new Set(d.picked).size !== d.picked.length) return null;
    return { signature, picked: [...d.picked] };
  } catch { return null; }
}
export function removeProfileSelectionDrafts(storage: Storage, profileId: string): void {
  const prefix = selectionDraftPrefix(profileId);
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  keys.forEach(key => storage.removeItem(key));
}
