import { validateStore } from './store-validation.ts';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (v: RecordValue, key: string) => Object.hasOwn(v, key);

export type StoryQualityCleanupCounts = {
  finishedLabelsRemoved: number;
  activeLabelsDeferred: number;
  activeSnapshotsDeferred: number;
  receiptLabelsDeferred: number;
  sessionsChanged: number;
};

/**
 * Work on a clone. Only remove the field from completed scenario answers.
 * Active runtimes and all receipts are intentionally untouched: changing these
 * could change the content or the response to an idempotent retry.
 */
export function cleanStoryQuality(input: unknown): { state: RecordValue; counts: StoryQualityCleanupCounts } {
  validateStore(input);
  if (!object(input)) throw new Error('Invalid store');
  const state = structuredClone(input);
  const counts: StoryQualityCleanupCounts = { finishedLabelsRemoved: 0, activeLabelsDeferred: 0, activeSnapshotsDeferred: 0, receiptLabelsDeferred: 0, sessionsChanged: 0 };
  if (!Array.isArray(state.sessions)) return {state, counts};
  // Detach records as well: callers may supply aliased objects unlike parsed JSON.
  const sessions = state.sessions.map(session => structuredClone(session));
  state.sessions = sessions;
  for (const raw of sessions) {
    if (!object(raw)) continue; // validateStore rejects this before cloning
    const receipt = object(raw.lastReceipt) ? raw.lastReceipt : undefined;
    const result = object(receipt?.result) ? receipt.result : undefined;
    const summary = object(result?.summary) ? result.summary : undefined;
    if (summary && has(summary, 'scenarioQuality')) counts.receiptLabelsDeferred++;
    const runtime = object(raw.runtime) ? raw.runtime : undefined;
    if (runtime) {
      if (object(raw.scenario) && has(raw.scenario, 'quality')) counts.activeLabelsDeferred++;
      if (object(runtime.scenarioAnswer) && has(runtime.scenarioAnswer, 'quality')) counts.activeLabelsDeferred++;
      // Snapshot versions/options and retry receipts are not touched on an active session.
      const hasLabel = (v: unknown): boolean => {
        if (Array.isArray(v)) return v.some(hasLabel);
        return object(v) && (has(v, 'quality') || Object.values(v).some(hasLabel));
      };
      if (hasLabel(runtime.items) || hasLabel(runtime.storyVersions)) counts.activeSnapshotsDeferred++;
      continue;
    }
    // A row without a runtime but without finishedAt may be incomplete or malformed.
    if (typeof raw.finishedAt !== 'number' || !Number.isFinite(raw.finishedAt)) {
      if (object(raw.scenario) && has(raw.scenario, 'quality')) counts.activeLabelsDeferred++;
      continue;
    }
    if (object(raw.scenario) && has(raw.scenario, 'quality')) {
      delete raw.scenario.quality;
      counts.finishedLabelsRemoved++;
      counts.sessionsChanged++;
    }
  }
  validateStore(state);
  return {state, counts};
}
