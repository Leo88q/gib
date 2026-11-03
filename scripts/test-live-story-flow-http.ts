/** Three phases on a disposable demo SQLite server, with a restart between phases. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.BASE ?? 'http://127.0.0.1:3071', marker=process.env.LIVE_STORY_TEST_FILE ?? 'data/live-story-flow-test.json';
const phase=process.argv[2], parent='xstate-http-synthetic';
async function req(url:string,body?:object) {const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
function answer(item:any) {if(item.type==='scenario')return {index:0};const x=item.instance;if(x.kind==='choice'||x.kind==='cards')return {index:0};if(x.kind==='switch-rounds')return {cells:x.rules.map(()=>0)};if(x.kind==='order')return {cells:x.steps.map((_:unknown,i:number)=>i)};if(x.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(x.kind))return {cells:[0]};if(x.kind==='gonogo')return {targets:[]};throw Error('unknown task');}
async function main(){
 if(phase==='prepare'){
  const p=await req('/api/profile',{name:'Тест',age:9}), profileId=p.profile.id;
  let result=await req('/api/session',{action:'start',profileId,storyChoice:true}); const {sessionId,steps}=result;
  await req('/api/session',{action:'select_story',sessionId,cardId:result.storyOffer[0].id});
  for(let step=0;step<3;step++){const item=result.next??result.item;if(step===2)assert.equal(item.type,'scenario');result=await req('/api/session',{action:'answer',sessionId,step,answer:answer(item)});}
  assert.equal(result.next.instance.kind,'social-practice');fs.writeFileSync(marker,JSON.stringify({profileId,sessionId,steps,step:3}));
 } else if(phase==='practice'){
  const m=JSON.parse(fs.readFileSync(marker,'utf8')); const resumed=await req('/api/session',{action:'start',profileId:m.profileId,storyChoice:true});assert.equal(resumed.step,3);assert.equal(resumed.item.instance.kind,'social-practice');
  const before=await req(`/api/player?profileId=${m.profileId}`),payload={action:'answer',sessionId:m.sessionId,step:3,answer:{skip:true}};
  const replies=await Promise.all(Array.from({length:5},()=>req('/api/session',payload))); for(const r of replies)assert.deepEqual(r,replies[0]);
  const after=await req(`/api/player?profileId=${m.profileId}`);assert.equal(after.player.xp-before.player.xp,15);assert.equal(after.player.coins-before.player.coins,5);assert.equal(replies[0].done,false);
 } else if(phase==='final'){
  const m=JSON.parse(fs.readFileSync(marker,'utf8'));let result=await req('/api/session',{action:'start',profileId:m.profileId,storyChoice:true});assert.equal(result.step,4);
  for(let step=4;step<m.steps;step++){result=await req('/api/session',{action:'answer',sessionId:m.sessionId,step,answer:answer(result.next??result.item)});}
  assert.equal(result.done,true);const r=await fetch(`${base}/api/profile?profileId=${m.profileId}`,{method:'DELETE',headers:{'x-demo-parent':parent}});assert.equal(r.status,200);fs.unlinkSync(marker);
 } else throw Error('expected prepare, practice or final');
 console.log(`  ok live story flow HTTP ${phase}`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
