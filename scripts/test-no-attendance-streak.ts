import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session';
import { publicPlayer } from '../lib/engine/player-view';
import { makeProfileExport } from '../lib/profile-export';
import { BADGES, emptyStats } from '../lib/gamification';
import { validateStore } from '../lib/store-validation';
import type { Profile, AgeBand } from '../lib/types';

for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,timeZone:'Europe/Moscow',createdAt:1};
 let mem=makeSessionMemory({profile,skills:[],sessions:[],programStates:[],playerStates:[]});
 const legacy=mem.store.playerState('p');legacy.streak=9;legacy.bestStreak=12;legacy.lastActiveDay='2020-01-01';
 const before={streak:legacy.streak,bestStreak:legacy.bestStreak,lastActiveDay:legacy.lastActiveDay};
 for(let attempt=0;attempt<2;attempt++){
  const started=startSession(profile,attempt===1,mem.store,{storyChoice:true});
  if(started.storyOffer) assert.deepEqual(selectSessionStory(started.sessionId,started.storyOffer[0].id,mem.store),{ok:true,cardId:started.storyOffer[0].id});
  for(let step=0;step<started.steps;step++){
   const session=mem.store.getSession(started.sessionId)!,item=session.runtime!.items[step];
   const payload=item.type==='scenario'?{index:0}:item.instance.kind==='social-practice'?{skip:true as const}:item.instance.answer!;
   const result=answerStep(started.sessionId,payload,0,step,mem.store);assert.ok(!('error' in result));
   const after=structuredClone(mem.store.playerState('p'));assert.deepEqual(answerStep(started.sessionId,payload,0,step,mem.store),result);assert.deepEqual(mem.store.playerState('p'),after);
  }
  const player=mem.store.playerState('p');assert.deepEqual({streak:player.streak,bestStreak:player.bestStreak,lastActiveDay:player.lastActiveDay},before);
  assert.equal(player.stats.days,attempt+1);assert.ok(player.xp>0);assert.ok(player.coins>0);
  const view=publicPlayer('p',mem.store).player;assert.ok(!('streak' in view));assert.ok(!('bestStreak' in view));assert.equal(view.stats.days,attempt+1);
  validateStore({profiles:[profile],sessions:mem.state.sessions,playerStates:mem.state.playerStates});
  mem=makeSessionMemory(mem.state); // persisted snapshots / restart
 }
 const exported=makeProfileExport({...mem.state,subs:[],payments:[]});assert.deepEqual({streak:exported.player[0].streak,bestStreak:exported.player[0].bestStreak,lastActiveDay:exported.player[0].lastActiveDay},before);
}
// Every badge must be independent of the obsolete consecutive-day values.
for(const days of [0,3,7,21,100]) {
 const common={stats:{...emptyStats(),days},badges:[],weekDone:3,perfectDays:1,inventory:[],skills:[]};
 const low={...common,streak:0,bestStreak:0},high={...common,streak:999,bestStreak:999};
 for(const badge of BADGES) assert.equal(badge.check(low),badge.check(high),badge.id);
}
console.log('  ok attendance: legacy preserved, no daily-streak updates, repeat/restart, export, badges and all ages');
