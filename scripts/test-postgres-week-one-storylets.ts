import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, selectOwnedStory, answerOwnedSession } from '../lib/postgres/session-repository';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gib-storylets-pg-'));let db=await PGlite.create(path.join(dir,'db'));let client:SqlClient={query:async(q,v)=>db.query(q,v)};
 try {
  await ensureSchema(client);const profiles:any[]=[],programStates:any[]=[];const bands: [AgeBand,number][]=[['5-7',6],['8-10',9],['11-13',12]];
  for(const [band,age] of bands)for(let day=1;day<=59;day++){const id=`p${age}_${day}`;profiles.push({id,parentId:`owner_${id}`,name:'Тест',age,band,createdAt:1});programStates.push({profileId:id,completedDays:day,lastDayIndex:day-1,startedAt:1});}
  await importLegacy(client,{profiles,sessions:[],programStates});const records:any[]=[];
  for(const p of profiles){const day=Number(p.id.split('_')[1]),started=await startOwnedSession(client,p.parentId,p.id,false,true);assert.ok(!('error' in started));assert.equal(started.storyOffer?.length,2);records.push({p,day,id:started.sessionId});}
  await db.close();db=await PGlite.create(path.join(dir,'db'));client={query:async(q,v)=>db.query(q,v)};
  for(const {p,day,id} of records){
   const suffix=['postcard','garden','bridge','puppet','club','library','pencil','station','cards','seedling','map','kite','workshop','team','assembly','banner','book','route','spill','crafts','materials','scarf','festival','choice','map','tempo','pause','example','design','space','remember','switch','note','check','supplies','path','step','tell','gallery','rules','weather','roles','signal','plan','prepare','garden','order','change','review','cloud','game','show','shadow','shapes','invite','comment','new','offer','finish'][day-1],cardId=`day_${day+1}_${suffix}`,scenarioId=`w${Math.floor(day/5)+1}d${day%5+1}_${suffix}`;
   const resumed=await startOwnedSession(client,p.parentId,p.id,false,true);assert.ok(!('error' in resumed));assert.equal(resumed.sessionId,id);assert.equal(resumed.resumed,true);
   assert.deepEqual(await selectOwnedStory(client,'other',id,cardId),{error:'session_not_found'});assert.deepEqual(await selectOwnedStory(client,p.parentId,id,cardId),{ok:true,cardId});
   for(let step=0;step<resumed.steps;step++){
    const row=(await client.query('SELECT data FROM gib.sessions WHERE id=$1',[id])).rows[0].data as any,item=row.runtime.items[step];
    if(item.type==='scenario')assert.equal(item.scenarioId,scenarioId);
    const practice=item.type==='task'&&item.instance.kind==='social-practice';if(practice)assert.deepEqual(item.instance.rounds,makeSupportPractice(p.band,scenarioId).rounds);
    const payload=item.type==='scenario'?{index:0}:practice?{skip:true}:item.instance.answer;const result=await answerOwnedSession(client,p.parentId,id,payload,0,step);assert.ok(!('error' in result));if(practice)assert.equal(result.evaluation,'not_scored');
   }
   const completed=(await client.query('SELECT data FROM gib.sessions WHERE id=$1',[id])).rows[0].data as any;assert.ok(completed.finishedAt);assert.equal(completed.scenario.scenarioId,scenarioId);assert.equal(completed.supportPracticeCompleted,undefined);
  }
  console.log('  ok PGlite: 59 new storylets × 3 ages, persisted offers, restart, owner and skip');
 }finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
