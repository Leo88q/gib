import assert from 'node:assert/strict';
import { Compiler } from 'inkjs/full';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep, publicItem } from '../lib/engine/session';
import { readDeepInk } from '../lib/engine/deep-ink';
import { validateStore } from '../lib/store-validation';
import type { AgeBand, Profile } from '../lib/types';

for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(const [scenarioId,day] of [['w1d1',0],['w1d1_music',0],['w1d1_picture',0],['w1d2',1],['w1d2_postcard',1],['w1d3',2],['w1d3_garden',2],['w1d4',3],['w1d4_bridge',3],['w1d5',4],['w1d5_puppet',4]] as const) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const initial=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:Math.max(0,day-1),startedAt:1}]});
 const start=startSession(profile,false,initial.store,{storyChoice:true,journey:true});
 const card=initial.state.sessions[0].runtime!.storyOffer!.find(c=>c.scenarioId===scenarioId)!;
 assert.ok(card);assert.deepEqual(selectSessionStory(start.sessionId,card.id,initial.store),{ok:true,cardId:card.id});
 const item=initial.state.sessions[0].runtime!.items[0];if(item.type!=='scenario')throw Error('scenario missing');
 const original=structuredClone(initial.state), variant=item.content!.variants[band];assert.ok(variant.deepInk);
 const view=publicItem(item,band);assert.equal(view.type,'scenario');if(view.type!=='scenario')throw Error();
 assert.equal(view.variant.followUps?.length,3);
 for(let i=0;i<3;i++)for(let j=0;j<2;j++){
  const mem=makeSessionMemory(structuredClone(original));const actual=item.order[i];const continuation=readDeepInk(variant.deepInk!,[actual]);
  assert.deepEqual(view.variant.followUps![i],continuation);
  const expected=readDeepInk(variant.deepInk!,[actual,j]);assert.equal(expected.choices.length,0);
  const response=answerStep(start.sessionId,{index:i,cells:[j]},0,0,mem.store);assert.ok(!('error' in response));
  assert.equal(response.feedback,expected.text);assert.equal(response.evaluation,'not_scored');assert.equal(response.reward.xp,25);assert.equal(response.reward.coins,8);
  assert.deepEqual(answerStep(start.sessionId,{index:i,cells:[j]},0,0,mem.store),response);
  assert.deepEqual(answerStep(start.sessionId,{index:i,cells:[1-j]},0,0,mem.store),{error:'step_conflict'});
  assert.deepEqual(mem.state.sessions[0].runtime!.storyFlow,{version:2,stage:'practice'});validateStore({profiles:[profile],sessions:mem.state.sessions});
 }
 const invalid=makeSessionMemory(structuredClone(original));
 for(const cells of [[],[-1],[2],[0,0]])assert.deepEqual(answerStep(start.sessionId,{index:0,cells},0,0,invalid.store),{error:'invalid_answer'});
 assert.equal(invalid.state.sessions[0].runtime!.index,0);
 // An old client may still finish with its original single choice.
 const old=makeSessionMemory(structuredClone(original));const oldResult=answerStep(start.sessionId,{index:0},0,0,old.store);
 assert.ok(!('error' in oldResult));assert.equal(oldResult.feedback,variant.options[item.order[0]].note);
 // Previously frozen offers without deepInk stay single-choice after reload.
 const legacy=structuredClone(original);const savedItem=legacy.sessions[0].runtime!.items[0];if(savedItem.type!=='scenario')throw Error();
 delete savedItem.content!.variants[band].deepInk;
 if(scenarioId==='w1d1_picture' && band==='11-13') {
  const v=savedItem.content!.variants[band];v.options[0].text='Спросить, хочет ли он помочь восстановить лист';
  const source=`${v.text}\n\n${v.options.map(o=>`* [${o.text}]\n    ${o.note}\n    -> END`).join('\n')}\n`;
  const compiler=new Compiler(source);const compiled=compiler.Compile().ToJson();assert.equal(compiler.errors.length,0);if(typeof compiled!=='string')throw Error('invalid fixture');v.ink={version:1,json:compiled};
 }
 validateStore({profiles:[profile],sessions:legacy.sessions});const resumed=makeSessionMemory(legacy);
 const opened=startSession(profile,false,resumed.store,{storyChoice:true,journey:true});assert.equal((opened.item as any).variant.followUps,undefined);
 assert.deepEqual(answerStep(start.sessionId,{index:0,cells:[0]},0,0,resumed.store),{error:'invalid_answer'});
 const corrupt=structuredClone(original);const corrupted=corrupt.sessions[0].runtime!.items[0];if(corrupted.type!=='scenario')throw Error();corrupted.content!.variants[band].deepInk!.json='bad';
 assert.throws(()=>validateStore({profiles:[profile],sessions:corrupt.sessions}),/Invalid story content/);
 (corrupted.content!.variants[band] as any).deepInk=null;assert.throws(()=>validateStore({profiles:[profile],sessions:corrupt.sessions}),/Invalid story content/);
}
console.log('  ok multi-step Ink: 11 stories × 3 ages × 6 paths, equal reward, replay, invalid choices, old clients and snapshots');
