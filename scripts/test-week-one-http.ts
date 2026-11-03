/** Run prepare/resume across restart with an isolated development SQLite DB. */
import fs from 'node:fs';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
const base = process.env.BASE ?? 'http://localhost:3000', file = process.env.WEEK_ONE_TEST_FILE ?? 'data/week-one-http.json';
const phase = process.argv[2];
async function req(parent: string, path: string, body?: object) {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {'content-type':'application/json','x-demo-parent':parent}, ...(body ? {body:JSON.stringify(body)} : {}) });
  return { status:res.status, data:await res.json() };
}
function check(x:unknown, text:string): asserts x { if (!x) throw Error(text); console.log('  ok', text); }
function answer(item:any) {
  if (item.type === 'scenario') return {index:0};
  const x = item.instance;
  if (x.kind === 'social-practice') return {cells:[0,1,2]};
  if (x.kind === 'choice' || x.kind === 'cards') return {index:0};
  if (x.kind === 'switch-rounds') return {cells:x.rules.map(() => 0)};
  if (x.kind === 'order') return {cells:x.steps.map((_:unknown,i:number)=>i)};
  if (x.kind === 'digits') return {digits:'1'};
  if (['memory','symbol-memory','finddiff'].includes(x.kind)) return {cells:[0]};
  if (x.kind === 'gonogo') return {targets:[]};
  throw Error('unknown task');
}
async function respond(parent:string, id:string, step:number, item:any, payload: object=answer(item)) {
  return req(parent,'/api/session',{action:'answer',sessionId:id,step,answer:payload,ms:100});
}
async function complete(parent:string, session:any, day:number, skip = false) {
  if(session.storyOffer && !session.storySelected) check((await req(parent,'/api/session',{action:'select_story',sessionId:session.sessionId,cardId:`day_${day}_default`})).status===200,'выбран исходный сюжет');
  let current = session, step = session.step ?? 0, saw = false;
  while (step < session.steps) {
    const item = current.next ?? current.item;
    if (item.type === 'scenario') check(item.scenarioId === `w1d${day}`, `день ${day}: правильный сюжет`);
    const isPractice = item.type === 'task' && item.instance.kind === 'social-practice';
    if (isPractice) {
      saw = true; check(item.instance.rounds.length === 3, `день ${day}: три карточки практики`);
      const age=parent.match(/week-one-(6|9|12)-/)?.[1]; const band:AgeBand=age==='6'?'5-7':age==='9'?'8-10':'11-13';
      check(!!age && JSON.stringify(item.instance.rounds)===JSON.stringify(makeSupportPractice(band, `w1d${day}`).rounds),'практика соответствует возрасту и дню');
      const incomplete = await respond(parent,session.sessionId,step,item,{cells:[0]}); check(incomplete.status === 400, 'неполный ответ отклонён');
    }
    const payload = isPractice && skip ? {skip:true} : answer(item);
    const result = await respond(parent,session.sessionId,step,item,payload);
    check(result.status === 200, 'шаг сохранён');
    if (isPractice) {
      check(result.data.evaluation === 'not_scored', 'практика не оценивается');
      const repeat = await respond(parent,session.sessionId,step,item,payload);
      check(repeat.status === 200 && JSON.stringify(result.data) === JSON.stringify(repeat.data), 'повтор не начисляет награду');
    }
    current = result.data; step++;
    if (current.done) break;
  }
  check(current.done && (day === 1 ? !saw : saw), 'день завершён с правильным набором этапов');
}
async function main() {
 if (phase === 'prepare') {
  const records=[];
  for (const age of [6,9,12]) {
   const parent=`week-one-${age}-${Date.now()}`;
   const p=await req(parent,'/api/profile',{name:'Тест',age}); const id=p.data.profile.id;
   const first=await req(parent,'/api/session',{action:'start',profileId:id});
   await complete(parent,first.data,1);
   const second=await req(parent,'/api/session',{action:'start',profileId:id,storyChoice:true});
   check(second.status===200 && second.data.steps===5 && second.data.storyOffer?.length===2, `${age}: второй день содержит практику и выбор истории`);
   check((await req(parent,'/api/session',{action:'select_story',sessionId:second.data.sessionId,cardId:'day_2_default'})).status===200,'выбран исходный сюжет второго дня');
   let current=second.data;
   for (let step=0; step<3; step++) {
    const item=current.next ?? current.item;
    const res=await respond(parent,second.data.sessionId,step,item); check(res.status===200,'первый блок дня сохранён'); current=res.data;
   }
   check(current.next?.instance?.kind==='social-practice', 'сессия остановлена перед практикой');
   records.push({parent,id,age,sessionId:second.data.sessionId,practice:current.next});
  }
  fs.writeFileSync(file,JSON.stringify(records));
 } else if (phase === 'resume') {
  const records=JSON.parse(fs.readFileSync(file,'utf8'));
  for (const r of records) {
   const resumed=await req(r.parent,'/api/session',{action:'start',profileId:r.id,storyChoice:true});
   check(resumed.data.resumed && resumed.data.step===3 && JSON.stringify(resumed.data.item)===JSON.stringify(r.practice), `${r.age}: снимок практики восстановлен`);
   check((await req('other-parent','/api/session',{action:'answer',sessionId:r.sessionId,step:3,answer:{skip:true}})).status===404,'чужой ответ отклонён');
   await complete(r.parent,resumed.data,2);
   for (const day of [3,4,5]) {
    const started=await req(r.parent,'/api/session',{action:'start',profileId:r.id,storyChoice:true});
    check(started.data.steps===(day===5?6:5), `день ${day}: правильное число шагов`);
    await complete(r.parent,started.data,day,day===4);
   }
   const map=await req(r.parent,`/api/practice-map?profileId=${r.id}`);
   const total=map.data.topics.reduce((sum:number,t:any)=>sum+t.practices,0);
   check(total===3,'карта показывает три выполненные практики, пропуск не учитывается');
   const report=await req(r.parent,`/api/report?profileId=${r.id}`);
   check(report.data.report.supportPracticesDone===3,'отчёт показывает только участие');
   const exported=await req(r.parent,`/api/profile/export?profileId=${r.id}`);
   check(exported.data.sessions.length===5 && exported.data.sessions.filter((s:any)=>s.supportPracticeCompleted).length===3, 'экспорт содержит только факты прохождения');
  }
  fs.unlinkSync(file);
 } else throw Error('use prepare or resume');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
