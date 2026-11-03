/** Four phases; restart the disposable SQLite demo server between phases. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.BASE??'http://127.0.0.1:3094';
const file=process.env.PROGRAM_JOURNEY_FILE??'data/program-journey-http.json';
const phase=Number(process.argv[2]);
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function req(parent:string,url:string,body?:object){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(r.status===429){await wait(61_000);continue;}assert.equal(r.status,200,`${url} ${JSON.stringify(data)}`);return data;
 }throw Error('rate limit persisted');
}
const post=(parent:string,body:object)=>req(parent,'/api/session',body);
function answer(item:any){if(item.type==='scenario')return {index:0};const x=item.instance;if(x.kind==='social-practice')return {skip:true};if(x.kind==='choice'||x.kind==='cards')return {index:0};if(x.kind==='switch-rounds')return {cells:x.rules.map(()=>0)};if(x.kind==='order')return {cells:x.steps.map((_:unknown,i:number)=>i)};if(x.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(x.kind))return {cells:[0]};if(x.kind==='gonogo')return {targets:[]};throw Error(`unknown ${x.kind}`);}
async function choose(r:any,day:number,repeat=false){
 const start=await post(r.parent,{action:'start',profileId:r.id,storyChoice:true,journey:true,repeat});assert.equal(start.step,0);assert.equal(start.storyOffer.length,day===1?3:2);
 const card=day%2===0?start.storyOffer.find((c:any)=>c.id!==`day_${day}_default`):start.storyOffer.find((c:any)=>c.id===`day_${day}_default`);assert.ok(card);
 const selected=await post(r.parent,{action:'select_story',sessionId:start.sessionId,cardId:card.id});assert.equal(selected.item.type,'scenario');assert.equal(selected.item.scenarioId,card.scenarioId);assert.equal(selected.step,0);
 return {start,item:selected.item};
}
async function finish(r:any,sessionId:string,steps:number,index:number,item:any,day:number){
 let result:any;
 while(index<steps){
  if(index===0)assert.equal(item.type,'scenario');if(index===1)assert.equal(item.instance.kind,'social-practice');
  const payload={action:'answer',sessionId,step:index,answer:answer(item)};result=await post(r.parent,payload);
  if(index===0 || index===1)assert.equal(result.evaluation,'not_scored');
  if((day===1||day===60) && index<=1)assert.deepEqual(await post(r.parent,payload),result);
  index++;if(result.done)break;item=result.next;
 }
 assert.equal(result.done,true);
}
async function main(){
 assert.ok(phase>=1&&phase<=4);const rows:any[]=phase===1?[]:JSON.parse(fs.readFileSync(file,'utf8'));
 if(phase===1)for(const age of [6,9,12]){const parent=`program-journey-${age}-${Date.now()}`,p=await req(parent,'/api/profile',{name:'Тест',age});rows.push({parent,id:p.profile.id,age});}
 for(const r of rows){
  if(phase>1){const resumed=await post(r.parent,{action:'start',profileId:r.id,storyChoice:true,journey:true});assert.equal(resumed.sessionId,r.sessionId);assert.equal(resumed.step,1);assert.deepEqual(resumed.item,r.item);await finish(r,r.sessionId,resumed.steps,1,resumed.item,(phase-1)*15+1);}
  const first=phase===1?1:(phase-1)*15+2;
  for(let day=first;day<=phase*15;day++){const {start,item}=await choose(r,day);await finish(r,start.sessionId,start.steps,0,item,day);}
  if(phase<4){const day=phase*15+1,{start,item}=await choose(r,day);const result=await post(r.parent,{action:'answer',sessionId:start.sessionId,step:0,answer:answer(item)});assert.equal(result.next.instance.kind,'social-practice');r.sessionId=start.sessionId;r.item=result.next;}
  else {
   const repeat=await choose(r,60,true);await finish(r,repeat.start.sessionId,repeat.start.steps,0,repeat.item,60);
   const plan=await req(r.parent,`/api/session?profileId=${r.id}`);assert.equal(plan.program.completedDays,60);const exp=await req(r.parent,`/api/profile/export?profileId=${r.id}`);assert.equal(exp.sessions.length,61);assert.ok(!JSON.stringify(exp.sessions).includes('"quality"'));assert.ok(!JSON.stringify(exp.sessions).includes('"ink"'));
   const del=await fetch(`${base}/api/profile?profileId=${r.id}`,{method:'DELETE',headers:{'x-demo-parent':r.parent}});assert.equal(del.status,200);
  }
  console.log(`  ok age ${r.age}, phase ${phase}, day ${phase*15}`);
 }
 if(phase<4)fs.writeFileSync(file,JSON.stringify(rows));else fs.unlinkSync(file);
}
main().catch(e=>{console.error(e);process.exitCode=1});
