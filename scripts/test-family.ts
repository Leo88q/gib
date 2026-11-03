import assert from 'node:assert/strict';
import { advanceFamily, emptyFamily, validFamilyState, publicFamily, type FamilyCommand } from '../lib/engine/family';
import { validateStore } from '../lib/store-validation';
import { FAMILY_IDEAS } from '../lib/content/family-ideas';
import { makeProfileExport } from '../lib/profile-export';
const send = (state: ReturnType<typeof emptyFamily>, action: FamilyCommand['action'], op: string, extra = {}, version = state.version) => advanceFamily(state, { action, operationId: op, expectedVersion: version, ...extra }, 'instance');
const chosen = send(emptyFamily(), 'choose', 'choose1', { ideaId: 'story' }); assert.ok(!('error' in chosen));
assert.equal(chosen.state.current?.status, 'chosen');
assert.deepEqual(send(chosen.state, 'confirm', 'bad'), { error: 'invalid_transition' });
assert.deepEqual(send(chosen.state, 'choose', 'choose1', { ideaId: 'colors' }, 0), { error: 'operation_conflict' });
assert.ok(!('error' in send(chosen.state, 'choose', 'choose1', { ideaId: 'story' }, 0)));
const reported = send(chosen.state, 'report', 'report'); assert.ok(!('error' in reported));
const confirmed = send(reported.state, 'confirm', 'confirm'); assert.ok(!('error' in confirmed));
assert.equal(confirmed.state.completed, 1); assert.equal(confirmed.state.current?.status, 'confirmed');
const replay = send(confirmed.state, 'confirm', 'confirm', {}, 2); assert.ok(!('error' in replay)); assert.equal(replay.replay, true); assert.equal(replay.state.completed, 1);
assert.deepEqual(send(confirmed.state, 'confirm', 'other', {}, 2), { error: 'version_conflict' });
const close = send(confirmed.state, 'close', 'close'); assert.ok(!('error' in close));
assert.equal(close.state.current, null); assert.equal(close.state.completed, 1);
const startAgain = send(close.state, 'choose', 'next', { ideaId: 'colors' }); assert.ok(!('error' in startAgain));
const canceled = send(startAgain.state, 'cancel', 'cancel'); assert.ok(!('error' in canceled)); assert.equal(canceled.state.completed, 1);
assert.deepEqual(send(canceled.state, 'report', 'x'), { error: 'invalid_transition' });
assert.deepEqual(send(canceled.state, 'choose', 'x', { ideaId: 'unknown' }), { error: 'invalid_action' });
for (const band of ['5-7','8-10','11-13'] as const) {
  const visible = publicFamily(chosen.state, band);
  assert.equal(visible.ideas.length, 6); assert.ok(visible.ideas.every(i => i.prompt && i.title));
  assert.equal(visible.current?.id, 'story'); assert.ok(!JSON.stringify(visible).includes('fingerprint'));
}
assert.equal(new Set(FAMILY_IDEAS.map(i => i.id)).size, 6);
const damaged = structuredClone(confirmed.state) as any; damaged.completed = -1;
assert.equal(validFamilyState(damaged), false);
assert.throws(() => validateStore({ profiles: [], sessions: [], playerStates: [{ profileId: 'p', family: damaged }] }), /Invalid family state/);
const profile = {id:'p', parentId:'owner', name:'test', age:8, band:'8-10' as const, createdAt:1};
const exported = makeProfileExport({ profile, skills:[], sessions:[], programStates:[], playerStates:[{profileId:'p', family: confirmed.state} as any], subs:[], payments:[] });
assert.equal(exported.player[0].family?.completed, 1); assert.ok(!JSON.stringify(exported).includes('fingerprint')); assert.ok(!JSON.stringify(exported).includes('operationId'));
let rolling = emptyFamily(); let serial = 0;
for (let i=0; i<25; i++) for (const action of ['choose','report','confirm','close'] as const) {
  const r = send(rolling, action, `id${serial++}`, action === 'choose' ? { ideaId:'story' } : {}); assert.ok(!('error' in r)); rolling = r.state;
}
assert.equal(rolling.receipts.length, 64); assert.equal(rolling.completed, 25);
assert.deepEqual(send(rolling, 'choose', 'id0', { ideaId:'story' }, 0), { error:'version_conflict' });
console.log('  ok семейные идеи: порядок, добровольный отказ, защита от повторов и старых запросов, валидация и минимальный экспорт');
