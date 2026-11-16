import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { WEEKS_NINE_TWELVE_STORY_OPTIONS } from '../lib/content/program/weeks-nine-twelve-story-options';
import { startOwnedSession, selectOwnedStory, answerOwnedSession } from '../lib/postgres/session-repository';
async function main() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gib-pg-final-day-'));
 let db=await PGlite.create(path.join(dir,'db')); let client:SqlClient={query:async(sql,v)=>db.query(sql,v)};
 try {
  await ensureSchema(client);
  await importLegacy(client,{profiles:[{id:'p',parentId:'owner',name:'Тест',age:12,band:'11-13',createdAt:1}],sessions:[],programStates:[{profileId:'p',completedDays:59,lastDayIndex:58,startedAt:1}]});
  const start=await startOwnedSession(client,'owner','p',false,true);
  assert.ok(!('error' in start)); assert.equal(start.steps,6); assert.ok((start.storyOffer?.length??0)>=2 && (start.storyOffer?.length??0)<=3); assert.deepEqual(await selectOwnedStory(client,'owner',start.sessionId,'day_60_default'),{ok:true,cardId:'day_60_default'});
  const read=async()=>((await client.query('SELECT data FROM gib.sessions WHERE id=$1',[start.sessionId])).rows[0].data as any);
  for(let step=0;step<2;step++) {
   const item=(await read()).runtime.items[step]; const payload=item.type==='scenario'?{index:0}:item.instance.answer;
   assert.ok(!('error' in await answerOwnedSession(client,'owner',start.sessionId,payload,0,step)));
  }
  const prior=await read(); const story=prior.runtime.items[2]; assert.equal(story.scenarioId,'w12d5');
  assert.deepEqual(story.content.variants['11-13'].options.map((o:any)=>o.text),WEEKS_NINE_TWELVE_STORY_OPTIONS.w12d5['11-13']);
  const storySnapshot=JSON.stringify(story);
  await db.close(); db=await PGlite.create(path.join(dir,'db')); client={query:async(sql,v)=>db.query(sql,v)};
  const atStory=await startOwnedSession(client,'owner','p',false,true); assert.ok(!('error' in atStory)); assert.equal(atStory.step,2); assert.equal(JSON.stringify((await read()).runtime.items[2]),storySnapshot);
  const storyAnswer=await answerOwnedSession(client,'owner',start.sessionId,{index:0},0,2); assert.ok(!('error' in storyAnswer)); assert.equal(storyAnswer.evaluation,'not_scored');
  const before=await read(); assert.equal(before.runtime.items[2].scenarioId,'w12d5'); assert.equal(before.runtime.items[3].instance.kind,'social-practice');
  const snapshot=JSON.stringify(before.runtime.items[3]);
  await db.close(); db=await PGlite.create(path.join(dir,'db')); client={query:async(sql,v)=>db.query(sql,v)};
  const resumed=await startOwnedSession(client,'owner','p',false,true);
  assert.ok(!('error' in resumed)); assert.equal(resumed.step,3); assert.equal(JSON.stringify((await read()).runtime.items[3]),snapshot);
  const result=await answerOwnedSession(client,'owner',start.sessionId,{skip:true},0,3);
  assert.ok(!('error' in result)); assert.equal(result.evaluation,'not_scored');
  assert.deepEqual(await answerOwnedSession(client,'owner',start.sessionId,{skip:true},0,3),JSON.parse(JSON.stringify(result)));
  for (let step=4;step<6;step++) { const item=(await read()).runtime.items[step]; assert.ok(!('error' in await answerOwnedSession(client,'owner',start.sessionId,item.instance.answer,0,step))); }
  assert.equal((await read()).supportPracticeCompleted,undefined);
  console.log('  ok PGlite: шестидесятый день, дополнительный этап, перезапуск, пропуск и финальное испытание');
 } finally { await db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
