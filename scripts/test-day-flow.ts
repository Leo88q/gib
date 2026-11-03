import assert from 'node:assert/strict';
import { PROGRAM_DAYS, SCENARIO_BY_ID } from '../lib/content/program/index';
import { selectStoryCards, type StoryCard } from '../lib/day/story-deck';
import { advanceDay, createDayFlow, type DayEvent, type DayFlow } from '../lib/day/day-flow';
import type { AgeBand } from '../lib/types';

const bands: AgeBand[] = ['5-7', '8-10', '11-13'];
for (let i = 0; i < 60; i++) for (const band of bands) {
  const cards = selectStoryCards(i, band, [], 'seed');
  assert.equal(cards.length, 1); // only the existing fallback exists so far
  assert.equal(cards[0].scenarioId, PROGRAM_DAYS[i].day.scenarioId);
  assert.equal(cards[0].title, SCENARIO_BY_ID[cards[0].scenarioId].variants[band].title);
  assert.ok(cards[0].practiceTaskId);
}
console.log('  ok каждый день и возраст получает настоящую историю и связанную практику');
const more: StoryCard[] = [
  { id: 'new_1', dayIndex: 0, bands, scenarioId: 'w1d2', requires: ['intro'] },
  { id: 'new_2', dayIndex: 0, bands: ['8-10'], scenarioId: 'w1d3' },
  { id: 'new_3', dayIndex: 0, bands, scenarioId: 'w1d5', repeatable: true },
];
const offer = selectStoryCards(0, '8-10', ['intro', 'new_2'], 'seed', more);
assert.equal(offer.length, 3);
assert.ok(offer.some(c => c.id === 'new_1'));
assert.ok(!offer.some(c => c.id === 'new_2'));
assert.deepEqual(offer, selectStoryCards(0, '8-10', ['intro', 'new_2'], 'seed', more));
assert.ok(!selectStoryCards(0, '5-7', [], 'seed', more).some(c => c.id === 'new_1' || c.id === 'new_2'));
assert.throws(() => selectStoryCards(-1, '5-7', [], 'seed'));
assert.throws(() => selectStoryCards(0, '5-7', [], 'seed', [{ ...more[0], scenarioId: 'w2d1' }]));
assert.throws(() => selectStoryCards(0, '5-7', [], 'seed', [more[0], more[0]]));
assert.throws(() => selectStoryCards(0, '5-7', [], 'seed', [{ ...more[0], scenarioId: 'w1d1' }]));
assert.throws(() => selectStoryCards(0, '5-7', [], 'seed', [{ ...more[0], scenarioId: '__proto__' }]));
console.log('  ok подбор ограничивает возраст, день, ранее открытые сцены и компетенцию');

for (const band of bands) {
  let state: DayFlow = createDayFlow(0, band, 'v1', selectStoryCards(0, band, [], 'test'));
  const events: DayEvent[] = [ { type: 'checkin_done' }, { type: 'pause_skipped' }, { type: 'story_selected', cardId: state.offer[0].id }, { type: 'story_done' }, { type: 'practice_done' }, { type: 'reflection_skipped' } ];
  assert.deepEqual(advanceDay(state, 'x', 0, { type: 'story_done' }), { error: 'invalid_transition' });
  assert.deepEqual(advanceDay(state, 'x', 1, events[0]), { error: 'version_conflict' });
  assert.deepEqual(advanceDay(state, 'x', 0, { type: 'checkin_done', feeling: 'sad' } as unknown as DayEvent), { error: 'invalid_request' });
  for (let i = 0; i < events.length; i++) {
    const old = structuredClone(state);
    const outcome = advanceDay(state, `op_${i}`, state.version, events[i]);
    assert.ok(!('error' in outcome)); assert.equal(outcome.replay, false); assert.deepEqual(state, old);
    state = JSON.parse(JSON.stringify(outcome.state)); // restored state after restart
    const retry = advanceDay(state, `op_${i}`, old.version, events[i]);
    assert.ok(!('error' in retry)); assert.equal(retry.replay, true); assert.deepEqual(retry.state, state);
  }
  assert.equal(state.stage, 'completed'); assert.equal(state.version, events.length);
  assert.equal(state.practice, 'done'); assert.equal(state.reflection, 'skipped');
  assert.deepEqual(advanceDay(state, 'op_0', 0, { type: 'pause_done' }), { error: 'operation_conflict' });
  const delayedRetry = advanceDay(state, 'op_0', 0, events[0]); assert.ok(!('error' in delayedRetry) && delayedRetry.replay);
  assert.deepEqual(advanceDay(state, 'extra', state.version, { type: 'checkin_done' }), { error: 'invalid_transition' });
  assert.ok(!JSON.stringify(state).includes('sad'));
}
const skipped = createDayFlow(0, '5-7', 'v1', selectStoryCards(0, '5-7', [], 'test'));
const run = (s: DayFlow, event: DayEvent, id: string) => { const r = advanceDay(s, id, s.version, event); if ('error' in r) throw Error(r.error); return r.state; };
let s = run(skipped, {type:'checkin_done'}, 'a'); s = run(s, {type:'pause_done'}, 'b');
assert.deepEqual(advanceDay(s, 'bad', s.version, {type:'story_selected', cardId:'foreign'}), {error:'invalid_transition'});
s = run(s, {type:'story_selected',cardId:s.offer[0].id}, 'c'); s = run(s, {type:'story_skipped'}, 'd'); s = run(s, {type:'practice_skipped'}, 'e'); s = run(s, {type:'reflection_done',choice:'tried'}, 'f');
assert.equal(s.story, 'skipped'); assert.equal(s.practice, 'skipped'); assert.equal(s.reflection, 'tried');
console.log('  ok три возраста, добровольные пропуски, порядок, перезапуск и повторы без изменения состояния');
