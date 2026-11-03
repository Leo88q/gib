import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { answerStep, publicItem, startSession, selectSessionStory } from '../lib/engine/session';
import { WEEKS_ONE_TWO_PRACTICES } from '../lib/content/program/weeks-one-two-practices';
import { REMAINING_PRACTICES } from '../lib/content/program/remaining-practices';
import { WEEK_THREE_PRACTICES } from '../lib/content/program/week-three-practices';
import { WEEK_FOUR_PRACTICES } from '../lib/content/program/week-four-practices';
import { WEEKS_FIVE_SIX_PRACTICES } from '../lib/content/program/weeks-five-six-practices';
import { WEEKS_SEVEN_EIGHT_PRACTICES } from '../lib/content/program/weeks-seven-eight-practices';
import { WEEKS_NINE_TEN_PRACTICES } from '../lib/content/program/weeks-nine-ten-practices';
import { WEEKS_ELEVEN_TWELVE_PRACTICES } from '../lib/content/program/weeks-eleven-twelve-practices';
import { makeSupportPractice } from '../lib/content/support-practice';
import { validateStore } from '../lib/store-validation';
import type { Profile, AgeBand } from '../lib/types';
for (const day of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 29, 30, 39, 40, 49, 50, 59]) for (const [band, age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand, number][]) {
 const profile: Profile = {id:'p', parentId:'owner', name:'Тест',age,band,createdAt:1};
 const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:day-1,startedAt:1}]});
 const start=startSession(profile,false,mem.store,{storyChoice:true});
 if(start.storyOffer) assert.deepEqual(selectSessionStory(start.sessionId,`day_${day+1}_default`,mem.store),{ok:true,cardId:`day_${day+1}_default`});
 for(let step=0;step<3;step++) {
  const item=mem.state.sessions[0].runtime!.items[step];
  assert.ok(!('error' in answerStep(start.sessionId,item.type==='scenario'?{index:0}:item.instance.answer!,0,step,mem.store)));
 }
 const saved=mem.state.sessions[0].runtime!.items[3]; assert.equal(saved.type,'task');
 // A session made before the upgrade has its own old generic text on disk.
 saved.instance.rounds![1].prompt='Старый снимок до обновления';
 saved.instance.rounds![1].options=['Старый вариант 1','Старый вариант 2','Старый вариант 3'];
 const frozen=structuredClone(publicItem(saved,band));
 const id=`w${Math.floor(day/5)+1}d${day%5+1}`;
 assert.notEqual(makeSupportPractice(band,id).rounds![1].prompt,'Старый снимок до обновления');
 const card = WEEKS_ONE_TWO_PRACTICES[id]?.[band][1] ?? WEEK_THREE_PRACTICES[id]?.[band][1] ?? WEEK_FOUR_PRACTICES[id]?.[band][1] ?? WEEKS_FIVE_SIX_PRACTICES[id]?.[band][1] ?? WEEKS_SEVEN_EIGHT_PRACTICES[id]?.[band][1] ?? WEEKS_NINE_TEN_PRACTICES[id]?.[band][1] ?? WEEKS_ELEVEN_TWELVE_PRACTICES[id]?.[band][1] ?? REMAINING_PRACTICES[id][0];
 const original=card.options[0];
 try {
  card.options[0]='Будущая версия каталога';
  const restarted=makeSessionMemory(structuredClone(mem.state));
  validateStore({profiles:[profile],sessions:restarted.state.sessions,playerStates:restarted.state.playerStates});
  const resumed=startSession(profile,false,restarted.store,{storyChoice:true});
  assert.equal(resumed.resumed,true); assert.equal(resumed.step,3); assert.deepEqual(resumed.item,frozen);
  const result=answerStep(start.sessionId,{cells:[0,1,2]},0,3,restarted.store);
  assert.ok(!('error' in result)); assert.equal(result.evaluation,'not_scored');
 } finally { card.options[0]=original; }
}
console.log('  ok старые снимки практик и будущие изменения каталога: восстановление без подмены ответов');
