import assert from 'node:assert/strict';
import { makeSupportPractice } from '../lib/content/support-practice';
import { parseSupportDraft } from '../lib/support-draft';
import type { AgeBand } from '../lib/types';
for (const id of ['w1d1', 'w1d1_music', 'w1d1_picture', 'w1d2', 'w1d3', 'w1d4', 'w1d5', 'w2d1', 'w2d2', 'w2d3', 'w2d4', 'w2d5', 'w3d1', 'w3d2', 'w3d3', 'w3d4', 'w3d5']) for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) {
  const task = makeSupportPractice(band, id);
  assert.equal(task.kind, 'social-practice'); assert.equal(task.rounds?.length, 3);
  assert.ok(task.rounds?.every(round => round.prompt && round.options.length === 3 && round.options.every(Boolean)));
  assert.equal(task.answer, undefined);
}
assert.throws(() => makeSupportPractice('5-7', 'unknown'));
const lengths = [3, 3, 3], sig = 'session-content';
assert.deepEqual(parseSupportDraft(JSON.stringify({ signature: sig, choices: [0, null, 2] }), sig, lengths), [0, null, 2]);
for (const invalid of [null, '{', JSON.stringify({signature:'old',choices:[0,1,2]}), JSON.stringify({signature:sig,choices:[0,3,2]}), JSON.stringify({signature:sig,choices:[0,1]}), JSON.stringify({signature:sig,choices:[0,'1',2]})]) assert.equal(parseSupportDraft(invalid, sig, lengths), null);
console.log('  ok пятьдесят одна возрастная практика без ключей ответа и восстановление безопасного черновика');
