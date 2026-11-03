import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DayFlowSqlite } from '../lib/day/day-flow-sqlite';
import { validateDayFlow } from '../lib/day/day-flow-validation';
const offer=[{id:'one',scenarioId:'w1d1',title:'Тест',practiceTaskId:'stroop'}];
const worker=(file:string,id:string,op:string,version:number,event:string)=>new Promise<any>((resolve,reject)=>{
 const p=spawn(process.execPath,['--import','tsx','scripts/test-day-flow-sqlite-worker.ts',file,'owner',id,op,String(version),event],{cwd:process.cwd()}); let out='',err='';
 p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error(err)));
});
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gib-day-flow-')),file=path.join(dir,'flows.sqlite');let repo=new DayFlowSqlite(file);
 try {
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  const first=repo.create('owner','p1',0,'5-7','v1',offer), second=repo.create('owner','p2',1,'8-10','v1',offer);
  assert.equal(repo.read('stranger',first.id),undefined);
  assert.deepEqual(repo.advance('stranger',first.id,'bad',0,{type:'checkin_done'}),{error:'not_found'});
  assert.deepEqual(repo.advance('owner',first.id,'bad',0,{type:'story_done'}),{error:'invalid_transition'});
  assert.deepEqual(repo.advance('owner',first.id,'bad',0,{type:'checkin_done', feeling:'sad'} as never),{error:'invalid_request'});
  assert.deepEqual(repo.read('owner',first.id),first.state);
  const injected=new DatabaseSync(file); injected.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON day_flow BEGIN SELECT RAISE(ABORT, 'injected'); END");
  assert.throws(()=>repo.advance('owner',first.id,'fail',0,{type:'checkin_done'}),/injected/);
  assert.deepEqual(repo.read('owner',first.id),first.state); injected.exec('DROP TRIGGER fail_update'); injected.close();
  repo.close();
  const racing=await Promise.all(Array.from({length:4},()=>worker(file,first.id,'same',0,'checkin_done')));
  assert.equal(racing.filter(r=>r.replay===false).length,1);assert.equal(racing.filter(r=>r.replay===true).length,3);
  const competing=await Promise.all([worker(file,first.id,'skip',1,'pause_skipped'),worker(file,first.id,'done',1,'pause_done')]);
  assert.equal(competing.filter(r=>r.state).length,1);assert.equal(competing.filter(r=>r.error==='version_conflict').length,1);
  repo=new DayFlowSqlite(file); let state=repo.read('owner',first.id)!;assert.equal(state.stage,'choose_story');
  assert.deepEqual(repo.advance('owner',first.id,'same',0,{type:'pause_skipped'}),{error:'operation_conflict'});
  assert.deepEqual(repo.advance('owner',first.id,'not-offered',2,{type:'story_selected',cardId:'other'}),{error:'invalid_transition'});
  for(const [op,event] of [['select',{type:'story_selected',cardId:'one'}],['story',{type:'story_done'}],['practice',{type:'practice_skipped'}],['reflection',{type:'reflection_skipped'}]] as const) {
   const result=repo.advance('owner',first.id,op,state.version,event);assert.ok(!('error' in result));state=result.state;
  }
  assert.equal(state.stage,'completed');validateDayFlow(state);
  assert.ok(!JSON.stringify(state).includes('feeling')); assert.equal(repo.read('owner',second.id)?.stage,'checkin');
  const corrupt=structuredClone(state);corrupt.story='skipped'; assert.throws(()=>validateDayFlow(corrupt));
  const extra=structuredClone(state) as any;extra.feeling='sad'; assert.throws(()=>validateDayFlow(extra));
  const leak=structuredClone(state) as any;leak.offer[0].feeling='sad';assert.throws(()=>validateDayFlow(leak));
  const badReceipt=structuredClone(state);badReceipt.receipts[0].version=4;assert.throws(()=>validateDayFlow(badReceipt));
  repo.close();const raw=new DatabaseSync(file);raw.prepare('UPDATE day_flow SET state=? WHERE id=?').run(JSON.stringify(corrupt),first.id);raw.close();
  repo=new DayFlowSqlite(file);assert.throws(()=>repo.read('owner',first.id),/invalid_day_flow_state/);
  assert.throws(()=>repo.advance('owner',first.id,'again',6,{type:'checkin_done'}),/invalid_day_flow_state/);
  assert.equal(repo.deleteProfile('stranger','p1'),0);assert.equal(repo.deleteProfile('owner','p1'),1);assert.equal(repo.read('owner',first.id),undefined);
  assert.equal(repo.read('owner',second.id)?.stage,'checkin');assert.equal(repo.deleteProfile('owner','p2'),1);
  console.log('  ok isolated SQLite: XState snapshots, 4 processes, retries, conflict, corruption and profile deletion');
 } finally {try{repo.close();}catch{} fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
