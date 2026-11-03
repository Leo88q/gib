import assert from 'node:assert/strict';
import { WEEKS_ONE_TWO_PRACTICES } from '../lib/content/program/weeks-one-two-practices';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
const bands:AgeBand[]=['5-7','8-10','11-13'];
const ids=['w1d1','w1d1_music','w1d1_picture',...Array.from({length:4},(_,i)=>`w1d${i+2}`),...Array.from({length:5},(_,i)=>`w2d${i+1}`)];
assert.deepEqual(Object.keys(WEEKS_ONE_TWO_PRACTICES).sort(),ids.sort());
for (const id of ids) {
 const values=WEEKS_ONE_TWO_PRACTICES[id];
 for(const band of bands) {
  const task=makeSupportPractice(band,id); assert.deepEqual(task.rounds,values[band]); assert.equal(task.answer,undefined);
  assert.ok(task.rounds?.every(r=>r.prompt && r.options.length===3 && new Set(r.options).size===3 && r.options.every(Boolean)));
 }
 for(let r=0;r<3;r++) {
  assert.equal(new Set(bands.map(b=>values[b][r].prompt)).size,3,`${id} round ${r}`);
  assert.equal(new Set(bands.map(b=>JSON.stringify(values[b][r].options))).size,3,`${id} options ${r}`);
 }
}
console.log('  ok 12 сюжетов × 3 возраста: отдельные карточки и варианты, без ключей оценки');
