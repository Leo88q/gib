/** Isolated development DB only: prepare / seed (server stopped) / resume / verify. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { validateStore } from '../lib/store-validation';
const base=process.env.BASE??'http://127.0.0.1:3089';
const file=process.env.STREAK_TEST_FILE??'data/no-attendance-streak-test.json';
const dbPath=process.env.STREAK_TEST_DB;
const phase=process.argv[2];
async function request(parent:string,url:string,method='GET',body?:object){const response=await fetch(base+url,{method,headers:{'content-type':'application/json','x-demo-parent':parent},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
async function session(parent:string,body:object){const r=await request(parent,'/api/session','POST',body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function answer(item:any){if(item.type==='scenario')return {index:0};const x=item.instance;if(x.kind==='social-practice')return {skip:true};if(['choice','cards'].includes(x.kind))return {index:0};if(x.kind==='switch-rounds')return {cells:x.rules.map(()=>0)};if(x.kind==='order')return {cells:x.steps.map((_:unknown,i:number)=>i)};if(x.kind==='digits')return {digits:'1'};if(['memory','symbol-memory','finddiff'].includes(x.kind))return {cells:[0]};if(x.kind==='gonogo')return {targets:[]};throw Error(`unknown ${x.kind}`);}
async function main(){
 const legacy={streak:9,bestStreak:12,lastActiveDay:'2020-01-01'};
 if(phase==='prepare'){
  const rows=[];
  for(const age of [6,9,12]){
   const parent=`no-streak-${age}-${Date.now()}`;const p=await request(parent,'/api/profile','POST',{name:'Тест',age});assert.equal(p.status,200);const id=p.data.profile.id;
   const started=await session(parent,{action:'start',profileId:id,storyChoice:true});assert.equal(started.storyOffer.length,3);
   await session(parent,{action:'select_story',sessionId:started.sessionId,cardId:'day_1_default'});
   const first=await session(parent,{action:'answer',sessionId:started.sessionId,step:0,answer:answer(started.item)});
   rows.push({parent,id,sessionId:started.sessionId,firstNext:first.next});
  }
  fs.writeFileSync(file,JSON.stringify(rows));
 }else if(phase==='seed'){
  // Caller must stop the server before modifying the intentionally disposable fixture.
  if(!dbPath||!dbPath.endsWith('/data/no-attendance-streak-isolated.sqlite')||!fs.existsSync(dbPath))throw Error('expected explicit isolated fixture path');
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));const db=new DatabaseSync(dbPath);
  try{db.exec('BEGIN IMMEDIATE');const state=JSON.parse(String(db.prepare('SELECT data FROM app_state WHERE id=1').get()?.data));
   for(const r of rows){const p=state.playerStates.find((x:any)=>x.profileId===r.id);assert.ok(p);Object.assign(p,legacy);}
   validateStore(state);db.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(state));db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
 }else if(phase==='resume'){
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const r of rows){
   const resumed=await session(r.parent,{action:'start',profileId:r.id,storyChoice:true});assert.equal(resumed.sessionId,r.sessionId);assert.equal(resumed.step,1);assert.deepEqual(resumed.item,r.firstNext);
   let current=resumed;for(let step=1;step<resumed.steps;step++){const item=current.next??current.item,payload=answer(item);current=await session(r.parent,{action:'answer',sessionId:r.sessionId,step,answer:payload});if(current.done){assert.deepEqual(await session(r.parent,{action:'answer',sessionId:r.sessionId,step,answer:payload}),current);break;}}assert.equal(current.done,true);
   const patch=await request(r.parent,'/api/profile','PATCH',{profileId:r.id,timeZone:'Asia/Vladivostok'});assert.equal(patch.status,200);assert.equal((await request('other-owner','/api/profile','PATCH',{profileId:r.id,timeZone:'Europe/Moscow'})).status,404);
  }
 }else if(phase==='verify'){
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const r of rows){
   for(const route of ['/api/player','/api/report','/api/session']){const result=await request(r.parent,`${route}?profileId=${r.id}`);assert.equal(result.status,200);const value=route==='/api/report'?result.data.report.player:route==='/api/player'?result.data.player:result.data;assert.ok(!('streak' in value));assert.ok(!('bestStreak' in value));}
   const report=await request(r.parent,`/api/report?profileId=${r.id}`);assert.equal(report.data.report.player.days,1);
   const exported=await request(r.parent,`/api/profile/export?profileId=${r.id}`);assert.equal(exported.status,200);const p=exported.data.player[0];assert.deepEqual({streak:p.streak,bestStreak:p.bestStreak,lastActiveDay:p.lastActiveDay},legacy);assert.equal(p.stats.days,1);assert.equal(exported.data.profile.timeZone,'Asia/Vladivostok');
   const del=await request(r.parent,`/api/profile?profileId=${r.id}`,'DELETE');assert.equal(del.status,200);
  }fs.unlinkSync(file);
 }else throw Error('specify prepare, seed, resume or verify');
 console.log(`  ok no attendance streak HTTP ${phase}, three ages`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
