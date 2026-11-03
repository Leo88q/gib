import assert from 'node:assert/strict';
import { WEEKS_FOUR_FIVE_STORY_OPTIONS } from '../lib/content/program/weeks-four-five-story-options';
import { REMAINING_DAYS } from '../lib/content/program/remaining-content';
import { SCENARIO_BY_ID } from '../lib/content/program';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, answerStep, publicItem, selectSessionStory } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { XP, COINS } from '../lib/gamification';
import type { AgeBand, Profile } from '../lib/types';
const ages:[AgeBand,number][]=[['5-7',6],['8-10',9],['11-13',12]];
assert.equal(Object.keys(WEEKS_FOUR_FIVE_STORY_OPTIONS).length,10);
for(let day=15;day<25;day++) {
 const id=`w${Math.floor(day/5)+1}d${day%5+1}`;
 const options=WEEKS_FOUR_FIVE_STORY_OPTIONS[id]; assert.ok(options);
 assert.equal(new Set(ages.map(([band])=>JSON.stringify(options[band]))).size,3);
 for(const [band,age] of ages) {
  const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
  const variant=SCENARIO_BY_ID[id].variants[band];
  assert.deepEqual(variant.options.map(x=>x.text),options[band]);
  assert.equal(new Set(options[band]).size,3); assert.ok(options[band].every(Boolean));
  assert.ok(variant.options.every(o=>!('quality' in o) && o.note===variant.options[0].note));
  const create=()=>makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:day-1,startedAt:1}]});
  const mem=create(), started=startSession(profile,false,mem.store,{storyChoice:true});
  if(started.storyOffer) assert.deepEqual(selectSessionStory(started.sessionId,`day_${day+1}_default`,mem.store),{ok:true,cardId:`day_${day+1}_default`});
  const rt=mem.state.sessions[0].runtime!, story=rt.items[2]; assert.equal(story.type,'scenario'); assert.ok(story.content);
  assert.deepEqual(story.content.variants[band].options.map(o=>o.text),options[band]);
  assert.notEqual(story.content.variants[band].options,variant.options);
  const savedOriginal=variant.options[0].text; variant.options[0].text='Новый текст каталога';
  try {assert.equal(story.content.variants[band].options[0].text,savedOriginal);} finally {variant.options[0].text=savedOriginal;}
  for(let step=0;step<2;step++){const item=rt.items[step];assert.equal(item.type,'task');assert.ok(!('error' in answerStep(started.sessionId,item.instance.answer!,0,step,mem.store)));}
  const state=structuredClone(mem.state), before=publicItem(story,band);
  for(let choice=0;choice<3;choice++) {
   const working=makeSessionMemory(state), player=working.state.playerStates[0], xp=player.xp, coins=player.coins;
   const resumed=startSession(profile,false,working.store,{storyChoice:true}); assert.equal(resumed.step,2);assert.deepEqual(resumed.item,before);
   const result=answerStep(started.sessionId,{index:choice},0,2,working.store);
   assert.ok(!('error' in result));assert.equal(result.evaluation,'not_scored');
   assert.equal(player.xp-xp,XP.scenarioGood);assert.equal(player.coins-coins,COINS.scenarioGood);
   assert.ok(!('quality' in working.state.sessions[0].runtime!.scenarioAnswer!));
   assert.deepEqual(answerStep(started.sessionId,{index:choice},0,2,working.store),result);
   assert.deepEqual(answerStep(started.sessionId,{index:(choice+1)%3},0,2,working.store),{error:'step_conflict'});
  }
  // Mimic a saved pre-upgrade version, including its shuffled order and legacy metadata.
  const old=create(), oldStarted=startSession(profile,false,old.store,{storyChoice:true});
  if(oldStarted.storyOffer) assert.deepEqual(selectSessionStory(oldStarted.sessionId,`day_${day+1}_default`,old.store),{ok:true,cardId:`day_${day+1}_default`});
  const oldStory=old.state.sessions[0].runtime!.items[2];assert.equal(oldStory.type,'scenario');assert.ok(oldStory.content);
  delete oldStory.content.variants[band].ink; // Pre-Ink saved snapshots did not contain a program.
  oldStory.content.variants[band].options=REMAINING_DAYS[id].actions.map((text,i)=>({text,note:`Старое пояснение ${i}`,quality: (['good','partial','bad'] as const)[i]}));
  for(let step=0;step<2;step++){const item=old.state.sessions[0].runtime!.items[step];assert.equal(item.type,'task');assert.ok(!('error' in answerStep(oldStarted.sessionId,item.instance.answer!,0,step,old.store)));}
  const oldPublic=publicItem(oldStory,band); const snapshot=structuredClone(old.state);
  const oldOrder=oldStory.order[0]; const catalogOption=variant.options[0].text; variant.options[0].text='Позднее обновление';
  try {
   const restored=makeSessionMemory(snapshot); validateStore({profiles:[profile],sessions:restored.state.sessions,playerStates:restored.state.playerStates});
   const resumed=startSession(profile,false,restored.store,{storyChoice:true}); assert.equal(resumed.resumed,true); assert.deepEqual(resumed.item,oldPublic);
   const result=answerStep(oldStarted.sessionId,{index:0},0,2,restored.store); assert.ok(!('error' in result));
   assert.equal(result.feedback,`Старое пояснение ${oldOrder}`); assert.equal(result.evaluation,'not_scored');
  } finally {variant.options[0].text=catalogOption;}
 }
}
console.log('  ok 10 историй × 3 возраста × 3 ответа: тексты, равные награды, старые снимки и порядок вариантов');
