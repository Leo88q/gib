import { WEEKS_NINE_TWELVE_STORY_OPTIONS } from '../lib/content/program/weeks-nine-twelve-story-options';
import { WEEKS_SIX_EIGHT_STORY_OPTIONS } from '../lib/content/program/weeks-six-eight-story-options';
import { WEEKS_FOUR_FIVE_STORY_OPTIONS } from '../lib/content/program/weeks-four-five-story-options';
import assert from 'node:assert/strict';
import { PROGRAM, SCENARIO_BY_ID } from '../lib/content/program';
import { REMAINING_DAYS } from '../lib/content/program/remaining-content';
import { REMAINING_PRACTICES } from '../lib/content/program/remaining-practices';
import { WEEK_FOUR_PRACTICES } from '../lib/content/program/week-four-practices';
import { WEEKS_FIVE_SIX_PRACTICES } from '../lib/content/program/weeks-five-six-practices';
import { WEEKS_SEVEN_EIGHT_PRACTICES } from '../lib/content/program/weeks-seven-eight-practices';
import { WEEKS_NINE_TEN_PRACTICES } from '../lib/content/program/weeks-nine-ten-practices';
import { WEEKS_ELEVEN_TWELVE_PRACTICES } from '../lib/content/program/weeks-eleven-twelve-practices';
import { makeSupportPractice } from '../lib/content/support-practice';
assert.equal(Object.keys(REMAINING_DAYS).length, 45);
assert.deepEqual(Object.keys(REMAINING_PRACTICES).sort(), Object.keys(REMAINING_DAYS).sort());
assert.equal(new Set(Object.values(REMAINING_PRACTICES).map(pair => JSON.stringify(pair))).size, 45);
for (const week of PROGRAM.slice(3)) for (const day of week.days) {
 const source = REMAINING_DAYS[day.scenarioId], scenario = SCENARIO_BY_ID[day.scenarioId];
 assert.ok(source); assert.equal(day.theme, source.title);
 assert.equal(new Set(source.actions).size, 3);
 assert.equal(new Set(source.situation).size, 3);
 for (const [index, band] of (['5-7','8-10','11-13'] as const).entries()) {
  const variant = scenario.variants[band], practice = makeSupportPractice(band, day.scenarioId);
  assert.ok(variant.text.includes(source.situation[index]));
  assert.deepEqual(variant.options.map(o=>o.text), WEEKS_FOUR_FIVE_STORY_OPTIONS[day.scenarioId]?.[band] ?? WEEKS_SIX_EIGHT_STORY_OPTIONS[day.scenarioId]?.[band] ?? WEEKS_NINE_TWELVE_STORY_OPTIONS[day.scenarioId]?.[band] ?? source.actions);
  assert.ok(variant.options.every(o=>o.note === variant.options[0].note));
  assert.equal(practice.rounds?.length,3);
  const adapted = WEEK_FOUR_PRACTICES[day.scenarioId] ?? WEEKS_FIVE_SIX_PRACTICES[day.scenarioId] ?? WEEKS_SEVEN_EIGHT_PRACTICES[day.scenarioId] ?? WEEKS_NINE_TEN_PRACTICES[day.scenarioId] ?? WEEKS_ELEVEN_TWELVE_PRACTICES[day.scenarioId];
  if (adapted) {
   assert.deepEqual(practice.rounds,adapted[band]);
  } else {
   assert.equal(practice.rounds?.[0].prompt,source.situation[index]);
   assert.deepEqual(practice.rounds?.[0].options,source.actions);
   assert.deepEqual(practice.rounds?.slice(1), REMAINING_PRACTICES[day.scenarioId]);
  }
  assert.ok(practice.rounds?.every(r=>r.prompt && r.options.length===3 && new Set(r.options).size===3));
  assert.equal(practice.answer,undefined);
 }
}
console.log('  ok 45 ситуаций, 135 возрастных вариантов и привязка практик; тематические продолжения');
