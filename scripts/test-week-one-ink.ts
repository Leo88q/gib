import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep, publicItem } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { readInkScene } from '../lib/engine/ink-snapshot';
import type { AgeBand, Profile } from '../lib/types';
for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(let day=0;day<5;day++) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const make=()=>makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:day,startedAt:1}]});
 const initial=make();const start=startSession(profile,false,initial.store,{storyChoice:true});const saved=initial.state.sessions[0];const rt=saved.runtime!;
 assert.equal(rt.storyOffer!.length,day===0?3:2);
 for(const card of rt.storyOffer!) {
  const v=rt.storyVersions![card.id].variants[band]; assert.ok(v.ink);const ink=v.ink;
  assert.deepEqual(readInkScene(ink),{text:v.text,choices:v.options.map(x=>x.text)});
  for(let n=0;n<v.options.length;n++)assert.equal(readInkScene(ink,n).text,v.options[n].note);
  const bad=structuredClone(initial.state);bad.sessions[0].runtime!.storyVersions![card.id].variants[band].ink!.json='invalid';assert.throws(()=>validateStore({profiles:[profile],sessions:bad.sessions}),/Invalid story versions/);
  for(let choice=0;choice<v.options.length;choice++){
   // Reopen the frozen offer, then reopen the chosen story before answering it.
   let mem=makeSessionMemory(structuredClone(initial.state));assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
   let runtime=mem.state.sessions[0].runtime!;const scenario=runtime.items[2];assert.equal(scenario.type,'scenario');if(scenario.type!=='scenario')throw Error('scenario missing');
   assert.deepEqual(scenario.content!.variants[band].ink,ink);
   for(let step=0;step<2;step++) {const item=runtime.items[step];assert.equal(item.type,'task');if(item.type!=='task')throw Error();assert.ok(!('error' in answerStep(start.sessionId,item.instance.answer!,0,step,mem.store)));}
   mem=makeSessionMemory(structuredClone(mem.state)); runtime=mem.state.sessions[0].runtime!;
   const item=runtime.items[2];assert.equal(item.type,'scenario');if(item.type!=='scenario')throw Error();const visible=publicItem(item,band);assert.equal(visible.type,'scenario');if(visible.type!=='scenario')throw Error();
   assert.equal(visible.variant.text,v.text);assert.equal(visible.variant.options[choice].text,v.options[item.order[choice]].text);
   const result=answerStep(start.sessionId,{index:choice},0,2,mem.store);assert.ok(!('error' in result));assert.equal(result.feedback,readInkScene(ink,item.order[choice]).text);
   assert.deepEqual(answerStep(start.sessionId,{index:choice},0,2,mem.store),result);validateStore({profiles:[profile],sessions:mem.state.sessions});
  }
 }
 // Old unversioned sessions still use their original plan and contain no Ink.
 const legacy=make();startSession(profile,false,legacy.store);assert.ok(!legacy.state.sessions[0].runtime!.storyVersions);
}
console.log('  ok first week: 11 stories × 3 ages × every Ink branch, frozen offers, resume, replay, corruption and legacy');
