import { nextDayStage } from './day-machine.ts';
import type { AgeBand } from '../types.ts';
import type { StoryChoice } from './story-deck.ts';

export type DayStage = 'checkin' | 'pause' | 'choose_story' | 'story' | 'practice' | 'reflection' | 'completed';
export type DayEvent =
  | { type: 'checkin_done' } | { type: 'pause_done' } | { type: 'pause_skipped' }
  | { type: 'story_selected'; cardId: string } | { type: 'story_done' } | { type: 'story_skipped' }
  | { type: 'practice_done' } | { type: 'practice_skipped' }
  | { type: 'reflection_done'; choice: 'enjoyed' | 'tried' | 'need_time' } | { type: 'reflection_skipped' };
type Receipt = { id: string; event: string; version: number };
export type DayFlow = {
  schemaVersion: 1; contentVersion: string; dayIndex: number; band: AgeBand;
  stage: DayStage; version: number; offer: StoryChoice[]; selected: string | null;
  story: 'done' | 'skipped' | null; practice: 'done' | 'skipped' | null;
  reflection: 'enjoyed' | 'tried' | 'need_time' | 'skipped' | null;
  receipts: Receipt[];
};
const key = /^[a-zA-Z0-9_-]{1,80}$/;

export function createDayFlow(dayIndex: number, band: AgeBand, contentVersion: string, offer: StoryChoice[]): DayFlow {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= 60 || !['5-7','8-10','11-13'].includes(band) || !key.test(contentVersion) || !Array.isArray(offer) || offer.length < 1 || offer.length > 3 || offer.some(c => !c || !key.test(c.id) || !key.test(c.scenarioId) || typeof c.title !== 'string' || !c.title || typeof c.practiceTaskId !== 'string' || !c.practiceTaskId) || new Set(offer.map(c => c.id)).size !== offer.length) throw Error('invalid_day_flow');
  return { schemaVersion: 1, contentVersion, dayIndex, band, stage: 'checkin', version: 0, offer: structuredClone(offer), selected: null, story: null, practice: null, reflection: null, receipts: [] };
}

/**
 * Pure transition. Caller must validate persisted state, check ownership, serialize
 * changes and persist the whole result atomically. No feeling value is accepted.
 * Receipts suppress duplicates for the lifetime of this day, including stale retries.
 */
export function advanceDay(state: DayFlow, operationId: string, expectedVersion: number, event: DayEvent): { state: DayFlow; replay: boolean } | { error: 'invalid_request' | 'operation_conflict' | 'version_conflict' | 'invalid_transition' } {
  if (typeof operationId !== 'string' || !key.test(operationId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !event || typeof event !== 'object' || Array.isArray(event)) return { error: 'invalid_request' };
  // Exact shape prevents unintentionally retaining feelings or arbitrary child text.
  const e = event as unknown as Record<string, unknown>;
  const keys = Object.keys(e).sort().join(',');
  if (typeof e.type !== 'string') return { error: 'invalid_request' };
  if (e.type === 'story_selected') {
    if (keys !== 'cardId,type' || typeof e.cardId !== 'string' || !key.test(e.cardId)) return { error: 'invalid_request' };
  } else if (e.type === 'reflection_done') {
    if (keys !== 'choice,type' || !['enjoyed','tried','need_time'].includes(e.choice as string)) return { error: 'invalid_request' };
  } else if (keys !== 'type' || !['checkin_done','pause_done','pause_skipped','story_done','story_skipped','practice_done','practice_skipped','reflection_skipped'].includes(e.type)) return { error: 'invalid_request' };
  // Canonical form independent of JSON key order.
  const fingerprint = e.type === 'story_selected' ? `${e.type}:${e.cardId}` : e.type === 'reflection_done' ? `${e.type}:${e.choice}` : e.type;
  const prior = state.receipts.find(r => r.id === operationId);
  if (prior) return prior.event === fingerprint ? { state: structuredClone(state), replay: true } : { error: 'operation_conflict' };
  if (state.version !== expectedVersion) return { error: 'version_conflict' };
  const next = structuredClone(state);
  const target = nextDayStage(next.stage, event);
  if (!target || (event.type === 'story_selected' && !next.offer.some(c => c.id === event.cardId))) return { error: 'invalid_transition' };
  next.stage = target;
  if (event.type === 'story_selected') next.selected = event.cardId;
  if (event.type === 'story_done' || event.type === 'story_skipped') next.story = event.type === 'story_done' ? 'done' : 'skipped';
  if (event.type === 'practice_done' || event.type === 'practice_skipped') next.practice = event.type === 'practice_done' ? 'done' : 'skipped';
  if (event.type === 'reflection_done' || event.type === 'reflection_skipped') next.reflection = event.type === 'reflection_done' ? event.choice : 'skipped';
  next.version++;
  next.receipts.push({ id: operationId, event: fingerprint, version: next.version });
  return { state: next, replay: false };
}
