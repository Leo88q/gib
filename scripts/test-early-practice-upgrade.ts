import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep, publicItem } from '../lib/engine/session';
import { WEEKS_ONE_TWO_PRACTICES } from '../lib/content/program/weeks-one-two-practices';
import { validateStore } from '../lib/store-validation';
import type { Profile, AgeBand } from '../lib/types';
for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(const cardId of ['day_1_default','day_1_music','day_1_picture']) {
 const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
 const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[]});
 const start=startSession(profile,false,mem.store,{storyChoice:true});
 const offer=start.storyOffer!.find(x=>x.id===cardId)!; const session=mem.state.sessions[0];
 const frozen=structuredClone(session.runtime!.supportVersions![cardId]);
 // Simulate a session whose old offer was created before a content update.
 frozen.rounds![1].prompt='Прежняя версия карточки'; session.runtime!.supportVersions![cardId]=structuredClone(frozen);
 const source=WEEKS_ONE_TWO_PRACTICES[offer.scenarioId][band][1]; const original=source.options[0];
 try {
  source.options[0]='Обновлённый вариант каталога';
  const reopened=makeSessionMemory(structuredClone(mem.state));
  validateStore({profiles:[profile],sessions:reopened.state.sessions,playerStates:reopened.state.playerStates});
  assert.deepEqual(selectSessionStory(start.sessionId,cardId,reopened.store),{ok:true,cardId});
  const selected=reopened.state.sessions[0]; const saved=selected.runtime!.items[3]; assert.equal(saved.type,'task'); assert.deepEqual(saved.instance,frozen);
  for(let step=0;step<3;step++){const item=selected.runtime!.items[step];assert.ok(!('error' in answerStep(start.sessionId,item.type==='scenario'?{index:0}:item.instance.answer!,0,step,reopened.store)));}
  const restarted=makeSessionMemory(structuredClone(reopened.state));
  const resumed=startSession(profile,false,restarted.store,{storyChoice:true});
  assert.equal(resumed.resumed,true);assert.equal(resumed.step,3);assert.deepEqual(resumed.item,publicItem(saved,band));
  assert.ok(!('error' in answerStep(start.sessionId,{cells:[0,1,2]},0,3,restarted.store)));
 } finally {source.options[0]=original;}
}
console.log('  ok 3 истории первого дня × 3 возраста: сохранённый до выбора снимок переживает обновление и рестарт');
