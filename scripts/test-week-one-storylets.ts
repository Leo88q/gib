import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep, publicItem } from '../lib/engine/session';
import { validateStore } from '../lib/store-validation';
import { selectStoryCards, DAY_STORY_CARDS } from '../lib/day/story-deck';
import { makeSupportPractice, hasSupportPractice } from '../lib/content/support-practice';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import type { AgeBand, Profile } from '../lib/types';
const extra=['w1d2_postcard','w1d3_garden','w1d4_bridge','w1d5_puppet','w2d1_club','w2d2_library','w2d3_pencil','w2d4_station','w2d5_cards','w3d1_seedling','w3d2_map','w3d3_kite','w3d4_workshop','w3d5_team','w4d1_assembly','w4d2_banner','w4d3_book','w4d4_route','w4d5_spill','w5d1_crafts','w5d2_materials','w5d3_scarf','w5d4_festival','w5d5_choice','w6d1_map','w6d2_tempo','w6d3_pause','w6d4_example','w6d5_design','w7d1_space','w7d2_remember','w7d3_switch','w7d4_note','w7d5_check','w8d1_supplies','w8d2_path','w8d3_step','w8d4_tell','w8d5_gallery','w9d1_rules','w9d2_weather','w9d3_roles','w9d4_signal','w9d5_plan','w10d1_prepare','w10d2_garden','w10d3_order','w10d4_change','w10d5_review','w11d1_cloud','w11d2_game','w11d3_show','w11d4_shadow','w11d5_shapes','w12d1_invite','w12d2_comment','w12d3_new','w12d4_offer','w12d5_finish'];
for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(let day=1;day<=59;day++) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const make=()=>makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:day-1,startedAt:1}]});
 const cards=selectStoryCards(day,band,[],'seed',DAY_STORY_CARDS); assert.equal(cards.length,2); assert.ok(cards.some(c=>c.scenarioId===extra[day-1]));
 const variant=STORYLETS_BY_ID[extra[day-1]].variants[band]; assert.equal(variant.options.length,3); assert.ok(!JSON.stringify(variant).includes('quality'));
 assert.ok(hasSupportPractice(extra[day-1])); const practice=makeSupportPractice(band,extra[day-1]); assert.equal(practice.rounds?.length,3);assert.ok(practice.rounds?.every(r=>r.prompt && r.options.length===3 && new Set(r.options).size===3));
 for(const card of cards) {
  let mem=make(),start=startSession(profile,false,mem.store,{storyChoice:true}),rt=mem.state.sessions[0].runtime!;
  const frozenStory=structuredClone(rt.storyVersions![card.id]), frozenPractice=structuredClone(rt.supportVersions![card.id]);
  frozenStory.variants[band].title='Снимок до обновления';frozenPractice.rounds![0].prompt='Снимок практики до обновления';
  rt.storyVersions![card.id]=frozenStory;rt.supportVersions![card.id]=frozenPractice;
  // Resume a saved offer after catalog changes and select either old or new story.
  mem=makeSessionMemory(mem.state); assert.equal(startSession(profile,false,mem.store,{storyChoice:true}).resumed,true);
  assert.deepEqual(selectSessionStory(start.sessionId,card.id,mem.store),{ok:true,cardId:card.id});
  let saved=mem.state.sessions[0];rt=saved.runtime!;
  assert.equal((rt.items[2] as any).content.variants[band].title,'Снимок до обновления'); assert.deepEqual((rt.items[3] as any).instance,frozenPractice);
  validateStore({profiles:[profile],sessions:mem.state.sessions});
  for(let step=0;step<3;step++) {const item=rt.items[step];const payload=item.type==='scenario'?{index:0}:item.instance.answer!;assert.ok(!('error' in answerStep(start.sessionId,payload,0,step,mem.store)));}
  mem=makeSessionMemory(mem.state);saved=mem.state.sessions[0];rt=saved.runtime!;const resumed=startSession(profile,false,mem.store,{storyChoice:true});assert.equal(resumed.step,3);assert.deepEqual(resumed.item,publicItem(rt.items[3],band));
  for(const payload of [{skip:true as const},...Array.from({length:27},(_,i)=>({cells:[Math.floor(i/9),Math.floor(i/3)%3,i%3]}))]){
   const copy=makeSessionMemory(mem.state), player=copy.state.playerStates[0], before=[player.xp,player.coins], skills=JSON.stringify(copy.state.skills);
   const result=answerStep(start.sessionId,payload,0,3,copy.store);assert.ok(!('error' in result));assert.equal(result.evaluation,'not_scored');assert.equal(player.xp-before[0],15);assert.equal(player.coins-before[1],5);assert.equal(JSON.stringify(copy.state.skills),skills);
   assert.deepEqual(answerStep(start.sessionId,payload,0,3,copy.store),result);
  }
 }
}
console.log('  ok 59 new stories × 3 ages × both choices: frozen snapshots, resume, 27 outcomes and skip');
