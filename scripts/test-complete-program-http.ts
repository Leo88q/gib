/** Run phases 1–4 across server restarts against the same isolated SQLite file. */
import fs from 'node:fs';
const base=process.env.BASE ?? 'http://localhost:3000';
const file=process.env.FULL_PROGRAM_TEST_FILE ?? 'data/full-program-http.json';
const phase=Number(process.argv[2]);
function check(value:unknown, message:string): asserts value { if(!value) throw Error(message); }
async function req(parent:string,path:string,body?:object) {
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json(); if(response.status>=400) throw Error(`${path}: ${response.status} ${JSON.stringify(data)}`); return data;
}
function answer(item:any) {
 if(item.type==='scenario') return {index:0};
 const x=item.instance;
 if(x.kind==='social-practice') return {cells:[0,1,2]};
 if(x.kind==='choice'||x.kind==='cards') return {index:0};
 if(x.kind==='switch-rounds') return {cells:x.rules.map(()=>0)};
 if(x.kind==='order') return {cells:x.steps.map((_:unknown,i:number)=>i)};
 if(x.kind==='digits') return {digits:'1'};
 if(['memory','symbol-memory','finddiff'].includes(x.kind)) return {cells:[0]};
 if(x.kind==='gonogo') return {targets:[]};
 throw Error(`unknown task ${x.kind}`);
}
async function step(parent:string,sessionId:string,n:number,item:any,payload:object=answer(item)) {
 return req(parent,'/api/session',{action:'answer',sessionId,step:n,answer:payload,ms:100});
}
async function finish(parent:string,session:any,day:number,withPractice:boolean) {
 if(session.storyOffer && !session.storySelected) await req(parent,'/api/session',{action:'select_story',sessionId:session.sessionId,cardId:`day_${day}_default`});
 let current=session, index=session.step??0, saw=index>3;
 while(index<session.steps) {
  const item=current.next??current.item;
  if(item.type==='scenario') check(item.scenarioId===`w${Math.ceil(day/5)}d${(day-1)%5+1}`,`story ${day}`);
  const practice=item.type==='task'&&item.instance.kind==='social-practice';
  const payload=practice&&day%10===0?{skip:true}:answer(item);
  if(practice){saw=true;check(item.instance.rounds.length===3,`rounds ${day}`)}
  const result=await step(parent,session.sessionId,index,item,payload);
  if(practice) {
   check(result.evaluation==='not_scored',`score ${day}`);
   if(day===16 || day===60) check(JSON.stringify(await step(parent,session.sessionId,index,item,payload))===JSON.stringify(result),`receipt ${day}`);
  }
  current=result; index++; if(result.done)break;
 }
 check(current.done && saw===withPractice,`completed ${day}`);
}
async function main(){
 check(Number.isInteger(phase)&&phase>=1&&phase<=4,'phase 1..4');
 const records: any[]=phase===1?[]:JSON.parse(fs.readFileSync(file,'utf8'));
 if(phase===1) for(const age of [6,9,12]) {
  const parent=`full-program-${age}-${Date.now()}`, p=await req(parent,'/api/profile',{name:'Тест',age});
  records.push({age,parent,id:p.profile.id});
 }
 for(const r of records) {
  if(phase>1) {
   const resumed=await req(r.parent,'/api/session',{action:'start',profileId:r.id,storyChoice:true});
   check(resumed.resumed && resumed.step===3 && JSON.stringify(resumed.item)===JSON.stringify(r.practice),`resume age ${r.age}`);
   await finish(r.parent,resumed,(phase-1)*15+1,true);
  }
  const first=phase===1?1:(phase-1)*15+2, last=phase*15;
  for(let day=first;day<=last;day++) {
   const opt=day>15, started=await req(r.parent,'/api/session',{action:'start',profileId:r.id,...(opt?{storyChoice:true}:{})});
   check(started.steps===(day%5===0?(opt?6:5):(opt?5:4)),`steps ${day}`);
   await finish(r.parent,started,day,opt);
  }
  if(phase<4) {
   const day=last+1, started=await req(r.parent,'/api/session',{action:'start',profileId:r.id,storyChoice:true});
   if(started.storyOffer && !started.storySelected) await req(r.parent,'/api/session',{action:'select_story',sessionId:started.sessionId,cardId:`day_${day}_default`});
   let current=started;
   for(let n=0;n<3;n++) current=await step(r.parent,started.sessionId,n,current.next??current.item);
   check(current.next?.instance?.kind==='social-practice',`snapshot day ${day}`);
   r.practice=current.next;
  } else {
   const map=await req(r.parent,`/api/practice-map?profileId=${r.id}`);
   check(map.topics.reduce((n:number,t:any)=>n+t.practices,0)===40,'map completed practice');
   const report=await req(r.parent,`/api/report?profileId=${r.id}`);
   check(report.report.supportPracticesDone===40,'report completed practice');
   const exported=await req(r.parent,`/api/profile/export?profileId=${r.id}`);
   check(exported.sessions.length===60 && exported.sessions.filter((s:any)=>s.supportPracticeCompleted).length===40,'export 60 sessions');
  }
  console.log(`  ok возраст ${r.age}: фаза ${phase}, до дня ${last}, снимки и добровольная практика`);
 }
 if(phase<4)fs.writeFileSync(file,JSON.stringify(records));else fs.unlinkSync(file);
}
main().catch(e=>{console.error(e);process.exitCode=1});
