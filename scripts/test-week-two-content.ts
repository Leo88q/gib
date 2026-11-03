import assert from 'node:assert/strict';
import { SCENARIO_BY_ID } from '../lib/content/program';
import { WEEK_2 } from '../lib/content/program/weeks-01-03';
import { makeSupportPractice } from '../lib/content/support-practice';
const forbidden = /тело иногда врёт|заставить голову|энергетик|не буду разговаривать весь день|сч[её]т на 4|вдох на 4|младш(ий|ая) (брат|сестра)/i;
assert.ok(!forbidden.test(JSON.stringify(WEEK_2)));
for (let day=1;day<=5;day++) {
 const id=`w2d${day}`, scenario=SCENARIO_BY_ID[id];
 assert.equal(scenario.competency,'self_regulation'); assert.ok(!forbidden.test(JSON.stringify(scenario)));
 for (const band of ['5-7','8-10','11-13'] as const) {
  const variant=scenario.variants[band];
  assert.equal(variant.options.length,3); assert.equal(new Set(variant.options.map(o=>o.text)).size,3);
  assert.ok(variant.options.every(o=>o.note && !/правильн|ошиб|зря|ты виноват/i.test(o.note)));
  const practice=makeSupportPractice(band,id); assert.equal(practice.rounds?.length,3);
  assert.ok(practice.rounds?.every(round=>round.options.length===3 && new Set(round.options).size===3));
 }
}
console.log('  ok 5 историй и 15 возрастных практик второй недели: структура, разные варианты и отсутствие прежних рискованных формулировок');
