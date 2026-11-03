/** Untrusted tab-local draft. No answer is persisted on the server until confirmation. */
export function parseSupportDraft(raw: string | null, signature: string, lengths: number[]): (number | null)[] | null {
  if (!raw || !lengths.length || lengths.some(n => !Number.isInteger(n) || n < 1 || n > 10)) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.signature !== signature || !Array.isArray(d.choices) || d.choices.length !== lengths.length ||
        !d.choices.every((v: unknown, i: number) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) < lengths[i]))) return null;
    return [...d.choices];
  } catch { return null; }
}
