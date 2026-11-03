import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENARIO_BY_ID } from '../lib/content/program';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import { DAY_ONE_ALTERNATIVE_FOLLOWUPS } from '../lib/content/program/day-one-alternative-deep-story';
import { DAY_FIVE_FOLLOWUPS } from '../lib/content/program/day-five-deep-story';
import { DAY_THREE_FOUR_FOLLOWUPS } from '../lib/content/program/day-three-four-deep-story';
import { DAY_TWO_FOLLOWUPS } from '../lib/content/program/day-two-deep-story';
import { FIRST_DAY_FOLLOWUPS } from '../lib/content/program/week-one-deep-story';
import type { AgeBand } from '../lib/types';

const url=new URL(process.env.BASE ?? ''), file=process.env.DEEP_STORY_TEST_FILE ?? '', phase=process.argv[2];
if(process.env.NODE_ENV==='production'||process.env.GIB_DEEP_STORY_DISPOSABLE!=='1'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash||!file.startsWith('/tmp/gib-deep-story-')||!['prepare','resume'].includes(phase??''))throw Error('isolated development test configuration required');
const base=url.origin;
async function req(parent:string,route:string,body?:unknown,method='POST'){
 const r=await fetch(base+route,{method,headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});return {status:r.status,data:await r.json()};
}
async function post(parent:string,body:unknown){const r=await req(parent,'/api/session',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function answer(item:any){
 if(item.type==='scenario')return {index:0};const t=item.instance;
 if(t.kind==='social-practice')return {skip:true};if(t.kind==='choice'||t.kind==='cards')return {index:0};
 if(t.kind==='switch-rounds')return {cells:t.rules.map(()=>0)};if(t.kind==='order')return {cells:t.steps.map((_:unknown,i:number)=>i)};
 if(t.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(t.kind))return {cells:[0]};
 if(t.kind==='gonogo')return {targets:[]};throw Error(`unknown task ${t.kind}`);
}
async function advanceDay(parent:string,profileId:string,day:number){
 const started=await post(parent,{action:'start',profileId,storyChoice:true,journey:true});
 const card=started.storyOffer.find((c:any)=>c.scenarioId===`w1d${day}`);assert.ok(card);
 let current=await post(parent,{action:'select_story',sessionId:started.sessionId,cardId:card.id});
 for(let step=0;step<started.steps;step++){
  const item=current.item??current.next;current=await post(parent,{action:'answer',sessionId:started.sessionId,step,answer:answer(item)});
  if(current.done)break;
 }
 assert.equal(current.done,true);
}
async function main(){
 if(phase==='prepare'){
  if(fs.existsSync(file))throw Error('fresh test file required');const rows=[];
  for(const [age,band] of [[6,'5-7'],[9,'8-10'],[12,'11-13']] as [number,AgeBand][]) for(const scenarioId of ['w1d1','w1d1_music','w1d1_picture','w1d2','w1d2_postcard','w1d3','w1d3_garden','w1d4','w1d4_bridge','w1d5','w1d5_puppet']){
   const parent=`deep-${age}-${scenarioId}-${Date.now()}`,p=await req(parent,'/api/profile',{name:'Тест',age});assert.equal(p.status,200);
   const targetDay=Number(scenarioId[3]);
   for(let day=1;day<targetDay;day++) await advanceDay(parent,p.data.profile.id,day);
   const start=await post(parent,{action:'start',profileId:p.data.profile.id,storyChoice:true,journey:true});
   const card=start.storyOffer.find((c:any)=>c.scenarioId===scenarioId);assert.ok(card);
   const chosen=await post(parent,{action:'select_story',sessionId:start.sessionId,cardId:card.id});assert.equal(chosen.item.variant.followUps.length,3);
   rows.push({parent,band,scenarioId,profileId:p.data.profile.id,sessionId:start.sessionId,item:chosen.item});
  }
  fs.writeFileSync(file,JSON.stringify(rows),{flag:'wx',mode:0o600});
 } else {
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const r of rows){
   const resumed=await post(r.parent,{action:'start',profileId:r.profileId,storyChoice:true,journey:true});assert.equal(resumed.resumed,true);assert.equal(resumed.step,0);assert.deepEqual(resumed.item,r.item);
   assert.equal((await req('wrong-owner','/api/session',{action:'answer',sessionId:r.sessionId,step:0,answer:{index:0,cells:[0]}})).status,404);
   const first=r.item.variant.options[0].text, variant=(SCENARIO_BY_ID[r.scenarioId] ?? STORYLETS_BY_ID[r.scenarioId]).variants[r.band as AgeBand], original=variant.options.findIndex(x=>x.text===first);assert.ok(original>=0);
   const bad=await req(r.parent,'/api/session',{action:'answer',sessionId:r.sessionId,step:0,answer:{index:0,cells:[7]}});assert.equal(bad.status,400);
   const body={action:'answer',sessionId:r.sessionId,step:0,answer:{index:0,cells:[1]}};
   const replies=await Promise.all(Array.from({length:4},()=>post(r.parent,body)));assert.ok(replies.every(x=>JSON.stringify(x)===JSON.stringify(replies[0])));
   assert.equal(replies[0].feedback,(r.scenarioId==='w1d1'? FIRST_DAY_FOLLOWUPS : r.scenarioId.startsWith('w1d2') ? DAY_TWO_FOLLOWUPS[r.scenarioId as keyof typeof DAY_TWO_FOLLOWUPS] : r.scenarioId.startsWith('w1d5') ? DAY_FIVE_FOLLOWUPS[r.scenarioId as keyof typeof DAY_FIVE_FOLLOWUPS] : r.scenarioId.startsWith('w1d3') || r.scenarioId.startsWith('w1d4') ? DAY_THREE_FOUR_FOLLOWUPS[r.scenarioId as keyof typeof DAY_THREE_FOUR_FOLLOWUPS] : DAY_ONE_ALTERNATIVE_FOLLOWUPS[r.scenarioId as keyof typeof DAY_ONE_ALTERNATIVE_FOLLOWUPS])[r.band as AgeBand][original].endings[1]);assert.equal(replies[0].evaluation,'not_scored');
   assert.equal((await req(r.parent,'/api/session',{...body,answer:{index:0,cells:[0]}})).status,409);
   const out=await req(r.parent,`/api/profile/export?profileId=${encodeURIComponent(r.profileId)}`,undefined,'GET');assert.equal(out.status,200);
   const del=await req(r.parent,`/api/profile?profileId=${encodeURIComponent(r.profileId)}`,undefined,'DELETE');assert.equal(del.status,200);
  }
  fs.unlinkSync(file);
 }
 console.log(`  ok deep Ink HTTP ${phase}: eleven stories × three ages, restore and safe ownership/replay`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
