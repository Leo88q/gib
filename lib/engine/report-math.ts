/** Accuracy change in percentage points; null means one period has no answers. */
export function accuracyDelta(current?: { ok: number; all: number }, previous?: { ok: number; all: number }): number | null {
  if (!current?.all || !previous?.all) return null;
  return Math.round((current.ok / current.all - previous.ok / previous.all) * 100);
}

/** Historical answers without an assisted flag remain unassisted for compatibility. */
export function unassistedAccuracy(sessions: { tasks: { skill: string; correct: boolean; assisted?: boolean }[] }[]): Record<string, { ok: number; all: number }> {
  const map: Record<string, { ok: number; all: number }> = {};
  for (const session of sessions) for (const task of session.tasks) {
    if (task.assisted) continue;
    const entry = map[task.skill] ??= { ok: 0, all: 0 };
    entry.all++;
    if (task.correct) entry.ok++;
  }
  return map;
}
