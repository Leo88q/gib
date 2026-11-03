import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import type { AgeBand, Profile } from '../lib/types';

for (const [band, age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for (const day of [0,1,4,59]) for (const skip of [false,true]) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 let mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:Math.max(0,day-1),startedAt:1}]});
 const start=startSession(profile,false,mem.store,{storyChoice:true}); let saved=mem.state.sessions[0];
 const valid=()=>validateStore({profiles:[profile],sessions:mem.state.sessions});
 valid(); assert.equal(saved.runtime!.storyFlow!.stage,start.storyOffer?'choose_story':'story');
 assert.ok(!JSON.stringify(saved.runtime!.storyFlow).includes('feeling'));
 if(start.storyOffer) {
  assert.deepEqual(answerStep(start.sessionId,{index:0},0,0,mem.store),{error:'story_selection_required'});
  const card=start.storyOffer[0]; assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  assert.deepEqual(selectSessionStory(start.sessionId,start.storyOffer[1].id,mem.store),{error:'story_conflict'});
  assert.equal(saved.runtime!.storyFlow!.stage,'story'); valid();
 }
 for(let step=0;step<start.steps;step++) {
  // Rehydrate independently before every step, as a process restart would.
  mem=makeSessionMemory(mem.state); saved=mem.state.sessions[0]; const rt=saved.runtime!, item=rt.items[step];
  const payload=item.type==='scenario'?{index:0}:item.instance.kind==='social-practice'?(skip?{skip:true as const}:{cells:[0,1,2]}):item.instance.answer!;
  const before=rt.storyFlow!.stage;
  const result=answerStep(start.sessionId,payload,0,step,mem.store); assert.ok(!('error' in result),JSON.stringify(result));
  assert.deepEqual(answerStep(start.sessionId,payload,0,step,mem.store),result);
  if(item.type==='scenario') {assert.equal(before,'story'); assert.equal(saved.runtime!.storyFlow!.stage,'practice');}
  if(item.type==='task' && item.instance.kind==='social-practice') {assert.equal(before,'practice'); if(saved.runtime) assert.equal(saved.runtime.storyFlow!.stage,'reflection');}
  if(saved.runtime) {valid();const broken=structuredClone(mem.state);broken.sessions[0].runtime!.storyFlow!.stage='choose_story';assert.throws(()=>validateStore({profiles:[profile],sessions:broken.sessions}),/story flow/);}
 }
 assert.ok(saved.finishedAt); assert.equal(saved.runtime,undefined); valid();
}
// Old in-progress sessions do not acquire or require a new flow marker.
{
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age:9,band:'8-10',createdAt:1};
 const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[]});
 const start=startSession(profile,false,mem.store,{storyChoice:true}); const rt=mem.state.sessions[0].runtime!; delete rt.storyFlow;
 validateStore({profiles:[profile],sessions:mem.state.sessions});
 const card=start.storyOffer![0]; assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
 for(let step=0;step<start.steps;step++) { const item=rt.items[step];const payload=item.type==='scenario'?{index:0}:item.instance.kind==='social-practice'?{skip:true as const}:item.instance.answer!; assert.ok(!('error' in answerStep(start.sessionId,payload,0,step,mem.store))); }
 assert.ok(mem.state.sessions[0].finishedAt);
}
console.log('  ok XState story segment: 3 ages, selected/single offers, resume, retries, skip, legacy and corruption');
