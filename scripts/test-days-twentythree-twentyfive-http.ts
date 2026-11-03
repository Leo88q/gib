/** prepare, choose, finish on an isolated SQLite demo server; restart between phases. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
const base=process.env.BASE??'http://127.0.0.1:3073', file=process.env.STORYLETS_TEST_FILE??'data/days-twentythree-twentyfive-http.json', phase=process.argv[2];
async function req(parent:string,url:string,body?:object){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
async function post(parent:string,body:object){const r=await req(parent,'/api/session',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function answer(item:any){if(item.type==='scenario')return {index:0};const x=item.instance;if(x.kind==='social-practice')return {cells:[0,1,2]};if(x.kind==='choice'||x.kind==='cards')return {index:0};if(x.kind==='switch-rounds')return {cells:x.rules.map(()=>0)};if(x.kind==='order')return {cells:x.steps.map((_:unknown,i:number)=>i)};if(x.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(x.kind))return {cells:[0]};if(x.kind==='gonogo')return {targets:[]};throw Error(`unknown ${x.kind}`);}
async function finish(r:any,started:any,expectedId:string){let current=started;for(let step=started.step??0;step<started.steps;step++){const item=current.next??current.item;if(item.type==='scenario')assert.equal(item.scenarioId,expectedId);if(item.type==='task'&&item.instance.kind==='social-practice')assert.deepEqual(item.instance.rounds,makeSupportPractice(r.band as AgeBand,expectedId).rounds);current=await post(r.parent,{action:'answer',sessionId:started.sessionId,step,answer:answer(item)});if(current.done)break;}assert.equal(current.done,true);}
async function main(){
 let rows:any[]=phase==='prepare'?[]:JSON.parse(fs.readFileSync(file,'utf8'));
 if(phase==='prepare')for(const [age,band] of [[6,'5-7'],[9,'8-10'],[12,'11-13']]){
  const parent=`days-twentythree-twentyfive-${age}-${Date.now()}`,p=await req(parent,'/api/profile',{name:'Тест',age});assert.equal(p.status,200);const r:any={parent,band,id:p.data.profile.id};rows.push(r);
  for(let day=1;day<=22;day++) {const old=await post(parent,{action:'start',profileId:r.id});const id=`w${Math.floor((day-1)/5)+1}d${(day-1)%5+1}`;await finish(r,old,id);}
  const day23=await post(parent,{action:'start',profileId:r.id,storyChoice:true});assert.equal(day23.storyOffer.length,2);r.offer=day23.storyOffer;r.sessionId=day23.sessionId;
 }
 else if(phase==='choose')for(const r of rows){
  const resumed=await post(r.parent,{action:'start',profileId:r.id,storyChoice:true});assert.equal(resumed.sessionId,r.sessionId);assert.deepEqual(resumed.storyOffer,r.offer);
  assert.equal((await req('wrong-owner','/api/session',{action:'select_story',sessionId:r.sessionId,cardId:'day_23_scarf'})).status,404);
  const choices=await Promise.all(Array.from({length:5},()=>post(r.parent,{action:'select_story',sessionId:r.sessionId,cardId:'day_23_scarf'})));assert.ok(choices.every(x=>x.cardId==='day_23_scarf'));
  const step=await post(r.parent,{action:'answer',sessionId:r.sessionId,step:0,answer:answer(resumed.item)});r.next=step.next;
 }
 else if(phase==='finish')for(const r of rows){
  let resumed=await post(r.parent,{action:'start',profileId:r.id,storyChoice:true});assert.equal(resumed.step,1);assert.deepEqual(resumed.item,r.next);await finish(r,resumed,'w5d3_scarf');
  for(const [cardId,scenarioId] of [['day_24_festival','w5d4_festival'],['day_25_choice','w5d5_choice']]){
   const started=await post(r.parent,{action:'start',profileId:r.id,storyChoice:true});assert.equal(started.storyOffer.length,2);assert.ok(started.storyOffer.some((c:any)=>c.id===cardId));await post(r.parent,{action:'select_story',sessionId:started.sessionId,cardId});await finish(r,started,scenarioId);
  }
  const exported=await req(r.parent,`/api/profile/export?profileId=${r.id}`);assert.equal(exported.status,200);assert.equal(exported.data.sessions.length,25);assert.ok(!JSON.stringify(exported.data.sessions).includes('"quality"'));
  const del=await fetch(`${base}/api/profile?profileId=${r.id}`,{method:'DELETE',headers:{'x-demo-parent':r.parent}});assert.equal(del.status,200);
 }
 else throw Error('specify prepare, choose, or finish');
 if(phase==='finish')fs.unlinkSync(file);else fs.writeFileSync(file,JSON.stringify(rows));console.log(`  ok days 23–25 storylets HTTP ${phase}, all three ages`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
