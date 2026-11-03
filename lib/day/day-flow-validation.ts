import { advanceDay, createDayFlow, type DayEvent, type DayFlow } from './day-flow.ts';

/** A persisted flow must be reproducible from its complete bounded receipt history. */
export function validateDayFlow(value: unknown): asserts value is DayFlow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_day_flow_state');
  const data = value as Record<string, unknown>;
  const fields = ['schemaVersion','contentVersion','dayIndex','band','stage','version','offer','selected','story','practice','reflection','receipts'];
  if (Object.keys(data).sort().join(',') !== fields.sort().join(',') || data.schemaVersion !== 1 || !Array.isArray(data.receipts) || data.receipts.length > 6) throw Error('invalid_day_flow_state');
  if (!Array.isArray(data.offer) || data.offer.some(card => !card || typeof card !== 'object' || Array.isArray(card) || Object.keys(card).sort().join(',') !== 'id,practiceTaskId,scenarioId,title' || typeof card.title !== 'string' || card.title.length > 200 || typeof card.practiceTaskId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(card.practiceTaskId))) throw Error('invalid_day_flow_state');
  let replay: DayFlow;
  try { replay = createDayFlow(data.dayIndex as number, data.band as DayFlow['band'], data.contentVersion as string, data.offer as DayFlow['offer']); }
  catch { throw Error('invalid_day_flow_state'); }
  for (const raw of data.receipts) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid_day_flow_state');
    const r = raw as Record<string, unknown>;
    if (Object.keys(r).sort().join(',') !== 'event,id,version' || typeof r.id !== 'string' || typeof r.event !== 'string' || r.version !== replay.version + 1) throw Error('invalid_day_flow_state');
    const event: DayEvent = r.event.startsWith('story_selected:') ? { type:'story_selected', cardId:r.event.slice('story_selected:'.length) }
      : r.event.startsWith('reflection_done:') ? { type:'reflection_done', choice:r.event.slice('reflection_done:'.length) as 'enjoyed'|'tried'|'need_time' }
      : { type:r.event } as DayEvent;
    const result = advanceDay(replay, r.id, replay.version, event);
    if ('error' in result || result.replay) throw Error('invalid_day_flow_state');
    replay = result.state;
  }
  // Compare explicit fields to avoid accepting inconsistent stages, results or receipts.
  for (const field of fields) if (JSON.stringify(data[field]) !== JSON.stringify(replay[field as keyof DayFlow])) throw Error('invalid_day_flow_state');
}
