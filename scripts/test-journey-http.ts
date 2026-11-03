/** Disposable SQLite demo: prepare, practice, finish; restart the server between phases. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.BASE??'http://127.0.0.1:3093', file=process.env.JOURNEY_FILE??'data/journey-http.json', phase=process.argv[2];
async function req(parent:string,url:string,body?:object){const res=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;}
const post=(p:string,body:object)=>req(p,'/api/session',body);
function answer(item:any){if(item.type==='scenario')return {index:0};const x=item.instance;if(x.kind==='social-practice')return {skip:true};if(x.kind==='choice'||x.kind==='cards')return {index:0};if(x.kind==='switch-rounds')return {cells:x.rules.map(()=>0)};if(x.kind==='order')return {cells:x.steps.map((_:unknown,i:number)=>i)};if(x.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(x.kind))return {cells:[0]};if(x.kind==='gonogo')return {targets:[]};throw Error(`unknown ${x.kind}`);}
async function complete(row:any,started:any,selected:any){let item=selected.item;assert.equal(item.type,'scenario');assert.equal(item.scenarioId,selected.scenarioId);let result:any;
 for(let step=0;step<started.steps;step++){result=await post(row.parent,{action:'answer',sessionId:started.sessionId,step,answer:answer(item)});if(step===0)assert.equal(result.next.instance.kind,'social-practice');if(result.done)break;item=result.next;}assert.equal(result.done,true);
}
async function main(){let rows:any[]=phase==='prepare'?[]:JSON.parse(fs.readFileSync(file,'utf8'));
 if(phase==='prepare')for(const age of [6,9,12]){
  const parent=`journey-v2-${age}-${Date.now()}`, p=await req(parent,'/api/profile',{name:'Тест',age});const row:any={parent,id:p.profile.id};rows.push(row);
  const started=await post(parent,{action:'start',profileId:row.id,storyChoice:true,journey:true});row.session=started.sessionId;row.steps=started.steps;assert.equal(started.step,0);assert.equal(started.storyOffer.length,3);
  const card=started.storyOffer.find((x:any)=>x.id!=='day_1_default');row.story=card.scenarioId;
  const selected=await post(parent,{action:'select_story',sessionId:row.session,cardId:card.id});assert.equal(selected.item.scenarioId,card.scenarioId);assert.equal(selected.item.type,'scenario');
  const result=await post(parent,{action:'answer',sessionId:row.session,step:0,answer:{index:0}});assert.equal(result.next.instance.kind,'social-practice');row.next=result.next;
 }
 else if(phase==='practice')for(const row of rows){
  const resumed=await post(row.parent,{action:'start',profileId:row.id,storyChoice:true,journey:true});assert.equal(resumed.sessionId,row.session);assert.equal(resumed.step,1);assert.deepEqual(resumed.item,row.next);
  const payload={action:'answer',sessionId:row.session,step:1,answer:{skip:true}};const results=await Promise.all(Array.from({length:4},()=>post(row.parent,payload)));assert.ok(results.every(r=>JSON.stringify(r)===JSON.stringify(results[0])));row.next=results[0].next;
 }
 else if(phase==='finish')for(const row of rows){
  const resumed=await post(row.parent,{action:'start',profileId:row.id,storyChoice:true,journey:true});assert.equal(resumed.step,2);assert.deepEqual(resumed.item,row.next);let item=resumed.item,result:any;
  for(let step=2;step<row.steps;step++){result=await post(row.parent,{action:'answer',sessionId:row.session,step,answer:answer(item)});item=result.next;}assert.equal(result.done,true);
  for(let day=2;day<=5;day++){
   const started=await post(row.parent,{action:'start',profileId:row.id,storyChoice:true,journey:true});assert.equal(started.step,0);const card=started.storyOffer.find((c:any)=>c.id!==`day_${day}_default`);const selection=await post(row.parent,{action:'select_story',sessionId:started.sessionId,cardId:card.id});assert.equal(selection.item.scenarioId,card.scenarioId);await complete(row,started,{...selection,scenarioId:card.scenarioId});
  }
  const exp=await req(row.parent,`/api/profile/export?profileId=${row.id}`);assert.equal(exp.sessions.length,5);const text=JSON.stringify(exp.sessions);assert.ok(!text.includes('"checkin"'));assert.ok(!text.includes('"reflection"'));assert.ok(!text.includes('"ink"'));
  const del=await fetch(`${base}/api/profile?profileId=${row.id}`,{method:'DELETE',headers:{'x-demo-parent':row.parent}});assert.equal(del.status,200);
 } else throw Error('phase');
 if(phase==='finish')fs.unlinkSync(file);else fs.writeFileSync(file,JSON.stringify(rows));console.log(`  ok journey HTTP ${phase}, three ages`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
