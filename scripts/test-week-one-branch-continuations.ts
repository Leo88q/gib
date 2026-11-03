import assert from 'node:assert/strict';
import { Compiler } from 'inkjs/full';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import { readInkScene } from '../lib/engine/ink-snapshot';
import type { AgeBand, Profile } from '../lib/types';

const stories = ['w1d2_postcard', 'w1d3_garden', 'w1d4_bridge', 'w1d5_puppet'];
const oldEndings = { puppet:'Это один из возможных вариантов. Можно выбрать другой или не обсуждать историю.', other:'Это один из возможных вариантов. Можно выбрать другой или обсудить историю позже.' };
for (const [band, age] of [['5-7', 6], ['8-10', 9], ['11-13', 12]] as [AgeBand, number][]) {
 for (let d = 0; d < stories.length; d++) {
  const id=stories[d], variant=STORYLETS_BY_ID[id].variants[band];
  const oldEnding = id === 'w1d5_puppet' ? oldEndings.puppet : oldEndings.other;
  assert.equal(new Set(variant.options.map(o=>o.note)).size, 3);
  assert.ok(variant.options.every(o=>o.note.length > 50 && !o.note.includes('правильн') && !o.quality));
  const profile: Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
  const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:d+1,lastDayIndex:d+1,startedAt:1}]});
  const start=startSession(profile,false,mem.store,{storyChoice:true,journey:true});
  const rt=mem.state.sessions[0].runtime!, card=rt.storyOffer!.find(c=>c.scenarioId===id)!;
  assert.ok(card); const frozen=rt.storyVersions![card.id].variants[band];
  for (let choice=0;choice<3;choice++) assert.equal(readInkScene(frozen.ink!,choice).text,variant.options[choice].note);
  assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  const persisted=structuredClone(mem.state);
  for(let displayed=0;displayed<3;displayed++) {
   const copy=makeSessionMemory(structuredClone(persisted)), item=copy.state.sessions[0].runtime!.items[0];
   if(item.type!=='scenario') throw Error('expected scenario');
   const expected=variant.options[item.order[displayed]].note;
   const result=answerStep(start.sessionId,{index:displayed},0,0,copy.store);
   assert.ok(!('error' in result)); assert.equal(result.feedback,expected); assert.equal(result.evaluation,'not_scored');
   assert.deepEqual(answerStep(start.sessionId,{index:displayed},0,0,copy.store),result);
   validateStore({profiles:[profile],sessions:copy.state.sessions});
  }
  // Simulate an older saved offer with the pre-upgrade generic Ink/notes. It must not
  // be substituted with the current catalog at selection or after a restart.
  const legacy=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:d+1,lastDayIndex:d+1,startedAt:1}]});
  const started=startSession(profile,false,legacy.store,{storyChoice:true,journey:true});
  const lrt=legacy.state.sessions[0].runtime!, lcard=lrt.storyOffer!.find(c=>c.scenarioId===id)!;
  const old=lrt.storyVersions![lcard.id].variants[band];
  for(const option of old.options) option.note=oldEnding;
  const source=`${old.text}\n\n${old.options.map(o=>`* [${o.text}]\n    ${oldEnding}\n    -> END`).join('\n')}\n`;
  const compiler=new Compiler(source);const story=compiler.Compile(); assert.deepEqual(compiler.errors,[]);
  const json=story.ToJson(); if(typeof json!=='string') throw Error('invalid old Ink');
  old.ink={version:1,json};
  delete old.deepInk;
  validateStore({profiles:[profile],sessions:legacy.state.sessions});
  let reopened=makeSessionMemory(structuredClone(legacy.state));
  assert.deepEqual(selectSessionStory(started.sessionId,lcard.id,reopened.store),{ok:true,cardId:lcard.id});
  reopened=makeSessionMemory(structuredClone(reopened.state));
  const result=answerStep(started.sessionId,{index:0},0,0,reopened.store);
  assert.ok(!('error' in result)); assert.equal(result.feedback,oldEnding); assert.equal(result.evaluation,'not_scored');
  validateStore({profiles:[profile],sessions:reopened.state.sessions});
 }
}
console.log('  ok week one: 4 stories × 3 ages × 3 distinct Ink endings, replay and old snapshots');
