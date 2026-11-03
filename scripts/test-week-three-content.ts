import assert from 'node:assert/strict';
import { WEEK_THREE_PRACTICES } from '../lib/content/program/week-three-practices';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
const bands: AgeBand[]=['5-7','8-10','11-13'];
assert.equal(Object.keys(WEEK_THREE_PRACTICES).length,5);
for(let day=1;day<=5;day++) {
 const id=`w3d${day}`, adaptations=WEEK_THREE_PRACTICES[id]; assert.ok(adaptations);
 for(const band of bands) {
  const practice=makeSupportPractice(band,id);
  assert.deepEqual(practice.rounds,adaptations[band]);
  assert.equal(practice.answer,undefined);
  const original = adaptations[band][0].options[0];
  practice.rounds![0].options[0] = "Изменение в копии";
  assert.equal(adaptations[band][0].options[0], original);
  assert.equal(makeSupportPractice(band,id).rounds![0].options[0],original);
  assert.ok(practice.rounds!.every(round=>round.prompt && round.options.length===3 && new Set(round.options).size===3 && round.options.every(Boolean)));
 }
 for(let round=0;round<3;round++) {
  assert.equal(new Set(bands.map(band=>adaptations[band][round].prompt)).size,3,`${id} round ${round+1} prompts`);
  assert.equal(new Set(bands.map(band=>JSON.stringify(adaptations[band][round].options))).size,3,`${id} round ${round+1} options`);
 }
}
console.log('  ok 5 дней × 3 возраста: разные формулировки и варианты во всех карточках; без ключа оценки');
