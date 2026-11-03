import assert from 'node:assert/strict';
import { nextJourneyStage } from '../lib/day/journey-machine';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep, publicItem } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { readInkScene } from '../lib/engine/ink-snapshot';
import type { AgeBand, Profile } from '../lib/types';
assert.equal(nextJourneyStage('checkin',{type:'story_selected'}),null);
assert.equal(nextJourneyStage('checkin',{type:'checkin_done'}),'pause');
assert.equal(nextJourneyStage('pause',{type:'pause_skipped'}),'choose_story');
assert.equal(nextJourneyStage('reflection',{type:'reflection_skipped'}),'completed');
for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(let day=0;day<60;day++){
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const fresh=()=>makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:day,startedAt:1}]});
 const initial=fresh(), start=startSession(profile,false,initial.store,{storyChoice:true,journey:true});
 assert.deepEqual(initial.state.sessions[0].runtime!.storyFlow,{version:2,stage:'choose_story'});
 const offered=initial.state.sessions[0].runtime!.storyOffer!;
 for(const card of offered) for(const skip of [true,false]){
  let mem=makeSessionMemory(structuredClone(initial.state));let session=mem.state.sessions[0], rt=session.runtime!;
  assert.equal(rt.plan[0].type,'scenario');assert.equal(rt.plan[1].type,'task');
  assert.deepEqual(answerStep(start.sessionId,{index:0},0,0,mem.store),{error:'story_selection_required'});
  assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  assert.deepEqual(selectSessionStory(start.sessionId,offered.find(c=>c.id!==card.id)!.id,mem.store),{error:'story_conflict'});
  rt=mem.state.sessions[0].runtime!;assert.deepEqual(rt.storyFlow,{version:2,stage:'story'});assert.equal(rt.items[0].type,'scenario');
  const item=rt.items[0];if(item.type!=='scenario')throw Error();assert.equal(item.scenarioId,card.scenarioId);assert.ok(item.content?.variants[band].ink);
  const variant=item.content.variants[band], ink=variant.ink!;assert.deepEqual(readInkScene(ink),{text:variant.text,choices:variant.options.map(o=>o.text)});for(let branch=0;branch<variant.options.length;branch++)assert.equal(readInkScene(ink,branch).text,variant.options[branch].note);
  validateStore({profiles:[profile],sessions:mem.state.sessions});
  mem=makeSessionMemory(structuredClone(mem.state));rt=mem.state.sessions[0].runtime!;
  const resumed=startSession(profile,false,mem.store,{journey:true,storyChoice:true});assert.equal(resumed.step,0);assert.deepEqual(resumed.item,publicItem(rt.items[0],band));
  const response=answerStep(start.sessionId,{index:0},0,0,mem.store);assert.ok(!('error' in response));assert.deepEqual(answerStep(start.sessionId,{index:0},0,0,mem.store),response);
  rt=mem.state.sessions[0].runtime!;assert.deepEqual(rt.storyFlow,{version:2,stage:'practice'});validateStore({profiles:[profile],sessions:mem.state.sessions});
  mem=makeSessionMemory(structuredClone(mem.state));const practice=answerStep(start.sessionId,skip?{skip:true}:{cells:[0,1,2]},0,1,mem.store);assert.ok(!('error' in practice));
  rt=mem.state.sessions[0].runtime!;assert.deepEqual(rt.storyFlow,{version:2,stage:'activities'});validateStore({profiles:[profile],sessions:mem.state.sessions});
  const corrupt=structuredClone(mem.state);corrupt.sessions[0].runtime!.storyFlow!.stage='story';assert.throws(()=>validateStore({profiles:[profile],sessions:corrupt.sessions}),/Invalid story flow/);
  for(let step=2;step<rt.items.length;step++){
   mem=makeSessionMemory(structuredClone(mem.state));rt=mem.state.sessions[0].runtime!;const t=rt.items[step];assert.equal(t.type,'task');if(t.type!=='task')throw Error();
   const result=answerStep(start.sessionId,t.instance.answer!,0,step,mem.store);assert.ok(!('error' in result));assert.equal(result.done,step===rt.items.length-1);
  }
  session=mem.state.sessions[0];assert.ok(session.finishedAt);assert.equal(session.runtime,undefined);assert.equal(session.supportPracticeCompleted,skip?undefined:true);
  assert.ok(!JSON.stringify(session).includes('checkin'));assert.ok(!JSON.stringify(session).includes('reflection'));
 }
 const old=fresh();startSession(profile,false,old.store,{storyChoice:true});assert.equal(old.state.sessions[0].runtime!.storyFlow!.version,1);assert.equal(old.state.sessions[0].runtime!.plan[2].type,'scenario');
 // Opting in while an earlier session is active resumes it without changing its version/order.
 const oldId=old.state.sessions[0].id;assert.equal(startSession(profile,false,old.store,{storyChoice:true,journey:true}).sessionId,oldId);assert.equal(old.state.sessions[0].runtime!.storyFlow!.version,1);
}
console.log('  ok journey v2: 60 days × three ages × every card and practice skip, restoration, retries, privacy and legacy');
{
 const profile:Profile={id:'future',parentId:'owner',name:'Тест',age:9,band:'8-10',createdAt:1};
 const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:profile.id,completedDays:5,lastDayIndex:4,startedAt:1}]});
 startSession(profile,false,mem.store,{storyChoice:true,journey:true});assert.equal(mem.state.sessions[0].runtime!.storyFlow!.version,2);
 const repeat=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:profile.id,completedDays:5,lastDayIndex:4,startedAt:1}]});
 startSession(profile,true,repeat.store,{storyChoice:true,journey:true});assert.equal(repeat.state.sessions[0].runtime!.storyFlow!.version,2);
}
