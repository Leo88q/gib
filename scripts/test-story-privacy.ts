import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { answerStep, startSession, selectSessionStory } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { makeProfileExport } from '../lib/profile-export';
import { XP, COINS } from '../lib/gamification';
import type { AgeBand, Profile } from '../lib/types';

for (const [band, age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand, number][]) for (const day of [0,15,59]) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const make=()=>makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:Math.max(0,day-1),startedAt:1}]});
 // Legacy single-story and opt-in plans both receive snapshots without legacy labels.
 const legacy=make(), plain=startSession(profile,false,legacy.store);
 assert.ok(plain.sessionId); assert.ok(!JSON.stringify(legacy.state.sessions[0].runtime?.items).includes('"quality"'));
 const mem=make(), start=startSession(profile,false,mem.store,{storyChoice:true});
 // For the first day, select one of the offered stories through the engine.
 if (start.storyOffer) {
  // Selection is separately covered by the postgres story and HTTP tests; every offer snapshot is sanitised.
  assert.ok(!JSON.stringify(mem.state.sessions[0].runtime?.storyVersions).includes('"quality"'));
  if(day===0) continue;
  const cardId=`day_${day+1}_default`;assert.deepEqual(selectSessionStory(start.sessionId,cardId,mem.store),{ok:true,cardId});
 }
 const rt=mem.state.sessions[0].runtime!;
 const story=rt.items[2]; assert.equal(story.type,'scenario');
 assert.ok(!JSON.stringify(story.content).includes('"quality"'));
 validateStore({profiles:[profile],sessions:mem.state.sessions,playerStates:mem.state.playerStates});
 for(let step=0;step<2;step++) {const task=rt.items[step];assert.equal(task.type,'task'); assert.ok(!('error' in answerStep(start.sessionId,task.instance.answer!,0,step,mem.store)));}
 const snapshot=structuredClone(mem.state);
 for(let index=0;index<3;index++) {
  const working=makeSessionMemory(snapshot), saved=working.state.sessions[0], player=working.state.playerStates[0];
  const xp=player.xp, coins=player.coins;
  const reply=answerStep(start.sessionId,{index},0,2,working.store);assert.ok(!('error' in reply));
  assert.equal(reply.evaluation,'not_scored'); assert.equal(player.xp-xp,XP.scenarioGood); assert.equal(player.coins-coins,COINS.scenarioGood);
  assert.ok(!('quality' in saved.runtime!.scenarioAnswer!));
  assert.deepEqual(answerStep(start.sessionId,{index},0,2,working.store),reply);
  assert.deepEqual(answerStep(start.sessionId,{index:(index+1)%3},0,2,working.store),{error:'step_conflict'});
  for(let step=3;step<start.steps;step++) {const task=saved.runtime!.items[step];assert.equal(task.type,'task');const answer=task.instance.kind==='social-practice'?{skip:true as const}:task.instance.answer!;const result=answerStep(start.sessionId,answer,0,step,working.store);assert.ok(!('error' in result));if(result.done)assert.ok(!('scenarioQuality' in result.summary!));}
  assert.ok(!('quality' in saved.scenario!));
  const exported=makeProfileExport({profile,skills:[],sessions:working.state.sessions,programStates:[],playerStates:[],subs:[],payments:[]});
  assert.ok(!JSON.stringify(exported.sessions[0].scenario).includes('"quality"'));
 }
}
// Exports must not silently conceal legacy personal data still retained in storage.
{
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age:9,band:'8-10',createdAt:1};
 const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:15,lastDayIndex:14,startedAt:1}]});
 const start=startSession(profile,false,mem.store,{storyChoice:true}); assert.deepEqual(selectSessionStory(start.sessionId,'day_16_default',mem.store),{ok:true,cardId:'day_16_default'}); const saved=mem.state.sessions[0], rt=saved.runtime!;
 for(let step=0;step<3;step++) {const item=rt.items[step];const answer=item.type==='scenario'?{index:0}:item.instance.answer!;assert.ok(!('error' in answerStep(start.sessionId,answer,0,step,mem.store)));}
 rt.scenarioAnswer!.quality='bad';
 const story=rt.items[2];assert.equal(story.type,'scenario');story.content!.variants['8-10'].options[0].quality='good';
 validateStore({profiles:[profile],sessions:mem.state.sessions,playerStates:mem.state.playerStates});
 const resumed=startSession(profile,false,makeSessionMemory(structuredClone(mem.state)).store,{storyChoice:true});assert.equal(resumed.resumed,true);
 const exported=makeProfileExport({profile,skills:[],sessions:mem.state.sessions,programStates:[],playerStates:[],subs:[],payments:[]});
 assert.equal(exported.sessions[0].inProgress?.scenario?.quality,'bad');
}
console.log('  ok новые ответы и снимки без оценочных меток, повторы, награды, legacy и прозрачный экспорт');
