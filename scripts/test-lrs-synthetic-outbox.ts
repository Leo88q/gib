import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { dispatchSyntheticLrs, putSyntheticLrsStatement, SyntheticLrsOutbox } from '../lib/experiments/lrs-synthetic-outbox';
const worker=(file:string,now:number)=>new Promise<any>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx','scripts/test-lrs-outbox-worker.ts',file,String(now)],{env:{...process.env,GIB_LRS_SYNTHETIC_LAB:'1'},cwd:process.cwd()});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error(err)));});
async function main(){
 process.env.GIB_LRS_SYNTHETIC_LAB='1';const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gib-lrs-lab-'));const file=path.join(dir,'gib-lrs-synthetic.sqlite');
 const rows=new Map<string,string>();let behavior:'drop'|'normal'|'conflict'|'error'|'redirect'|'rejected'|'rate'='drop';let calls=0;
 const server=createServer(async(req,res)=>{
  calls++;const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=Buffer.concat(chunks).toString();const url=new URL(req.url!,'http://localhost');
  try{
   assert.equal(url.pathname,'/xapi/statements');assert.equal(req.headers.authorization,'Basic a2V5OnNlY3JldA==');assert.equal(req.headers['x-experience-api-version'],'1.0.3');
   const id=url.searchParams.get('statementId')!;
   if(req.method==='GET'){if(!rows.has(id)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(rows.get(id));return;}
   assert.equal(req.method,'PUT');const obj=JSON.parse(body);assert.equal(id,obj.id);assert.deepEqual(Object.keys(obj).sort(),['actor','id','object','timestamp','verb']);assert.equal(obj.actor.account.name,'synthetic-test');assert.equal(obj.timestamp,'2020-01-01T00:00:00Z');
   if(behavior==='redirect'){res.writeHead(302,{location:'http://example.com'});res.end();return;}
   if(behavior==='error'){res.writeHead(503);res.end();return;}
   if(behavior==='rejected'){res.writeHead(401);res.end();return;}
   if(behavior==='rate'){res.writeHead(429);res.end();return;}
   if(behavior==='conflict'||(rows.has(id)&&rows.get(id)!==body)){res.writeHead(409);res.end();return;}
   rows.set(id,body);
   if(behavior==='drop'){req.socket.destroy();return;}
   res.writeHead(204);res.end();
  }catch(e){res.statusCode=500;res.end(String(e));}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let repo=new SyntheticLrsOutbox(file);
 try {
  assert.equal(fs.statSync(file).mode&0o777,0o600);const id=repo.enqueue();assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'retry');
  assert.equal(rows.size,1);const pending=repo.read(id)!;assert.equal(pending.status,'pending');assert.equal(pending.attempts,1);repo.close();
  repo=new SyntheticLrsOutbox(file);behavior='normal';assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret',Number(pending.due)),'sent');assert.equal(rows.size,1);assert.equal(repo.read(id)!.status,'sent');assert.equal(repo.read(id)!.attempts,2);assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret',Number(pending.due)),'empty');
  assert.equal(await putSyntheticLrsStatement(base,'key','secret',id),'accepted');assert.equal(rows.size,1);
  const conflict=repo.enqueue();behavior='conflict';assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'conflict');assert.equal(repo.read(conflict)!.status,'conflict');assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'empty');
  const rejected=repo.enqueue();behavior='rejected';assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'rejected');assert.equal(repo.read(rejected)!.status,'rejected');assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'empty');
  const fail=repo.enqueue();behavior='error';assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret'),'retry');assert.equal(repo.read(fail)!.status,'pending');behavior='rate';assert.equal(await dispatchSyntheticLrs(repo,base,'key','secret',Number(repo.read(fail)!.due)),'retry');assert.equal(repo.read(fail)!.attempts,2);
  behavior='redirect';await assert.rejects(()=>putSyntheticLrsStatement(base,'key','secret',id));
  await assert.rejects(()=>putSyntheticLrsStatement('http://example.com:80','key','secret',id),/loopback_only/);await assert.rejects(()=>putSyntheticLrsStatement(base,'bad:key','secret',id),/invalid_lab_credentials/);
  await assert.rejects(()=>dispatchSyntheticLrs(repo,base,'key','secret',Date.now(),'bad' as never),/invalid_lab_endpoint/);
  const before=calls;await assert.rejects(()=>dispatchSyntheticLrs(repo,'http://example.com:80','key','secret'),/loopback_only/);assert.equal(calls,before);
  // Isolate the concurrency test from delayed retries.
  repo.close();const raceDir=path.join(dir,'race');fs.mkdirSync(raceDir);const raceFile=path.join(raceDir,'gib-lrs-synthetic.sqlite');repo=new SyntheticLrsOutbox(raceFile);const raceId=repo.enqueue();const t=Date.now();repo.close();
  const races=await Promise.all(Array.from({length:4},()=>worker(raceFile,t)));const winner=races.filter(Boolean);assert.equal(winner.length,1);assert.equal(winner[0].id,raceId);
  repo=new SyntheticLrsOutbox(raceFile);assert.equal(repo.reserve(t+29_999,30000),null);const renewed=repo.reserve(t+30_001,30000)!;assert.equal(renewed.id,raceId);assert.notEqual(renewed.token,winner[0].token);
  assert.equal(repo.finish(winner[0],'accepted',t+30_002),false);assert.equal(repo.finish(renewed,'accepted',t+30_002),true);assert.equal(repo.read(raceId)!.status,'sent');repo.close();
  // Exercise both phases of the optional real-LRS checker against this explicitly fake service.
  behavior='normal';const probeDir=path.join(dir,'real-probe');fs.mkdirSync(probeDir);const probeFile=path.join(probeDir,'gib-lrs-synthetic.sqlite');
  const probe=(phase:string)=>new Promise<void>((resolve,reject)=>{const proc=spawn(process.execPath,['--import','tsx','scripts/test-lrs-lab-real.ts',phase],{cwd:process.cwd(),env:{...process.env,GIB_LRS_SYNTHETIC_LAB:'1',GIB_LRS_LAB_BASE:base,GIB_LRS_LAB_KEY:'key',GIB_LRS_LAB_SECRET:'secret',GIB_LRS_LAB_OUTBOX:probeFile}});let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);proc.on('error',reject);proc.on('close',code=>code===0?resolve():reject(Error(output)));});
  await probe('prepare');await probe('resume');
  // Old fixture format had a different PUT body and must never be replayed.
  const oldDir=path.join(dir,'old');fs.mkdirSync(oldDir);const oldFile=path.join(oldDir,'gib-lrs-synthetic.sqlite');const old=new SyntheticLrsOutbox(oldFile);old.enqueue();old.close();const legacy=new DatabaseSync(oldFile);legacy.exec('PRAGMA user_version=1');legacy.close();assert.throws(()=>new SyntheticLrsOutbox(oldFile),/invalid_lab_database/);
  // Never open unrelated databases or follow symlinks, even with the expected filename.
  const otherDir=path.join(dir,'other');fs.mkdirSync(otherDir);const otherFile=path.join(otherDir,'gib-lrs-synthetic.sqlite');const other=new DatabaseSync(otherFile);other.exec('CREATE TABLE app_state (id INTEGER)');other.close();fs.chmodSync(otherFile,0o644);assert.throws(()=>new SyntheticLrsOutbox(otherFile),/invalid_lab_database/);assert.equal(fs.statSync(otherFile).mode&0o777,0o644);
  const symDir=path.join(dir,'symlink');fs.mkdirSync(symDir);fs.symlinkSync(otherFile,path.join(symDir,'gib-lrs-synthetic.sqlite'));assert.throws(()=>new SyntheticLrsOutbox(path.join(symDir,'gib-lrs-synthetic.sqlite')),/invalid_lab_database/);
  assert.throws(()=>new SyntheticLrsOutbox(path.join(dir,'wrong.sqlite')),/invalid_lab_database/);
  process.env.GIB_LRS_SYNTHETIC_LAB='0';assert.throws(()=>new SyntheticLrsOutbox(':memory:'),/synthetic_lab_disabled/);
  process.env.GIB_LRS_SYNTHETIC_LAB='1';const prev=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'production'});try{assert.throws(()=>new SyntheticLrsOutbox(':memory:'),/synthetic_lab_disabled/);await assert.rejects(()=>putSyntheticLrsStatement(base,'key','secret',id),/synthetic_lab_disabled/);}finally{if(prev===undefined)delete (process.env as Record<string,string|undefined>).NODE_ENV;else Object.assign(process.env,{NODE_ENV:prev});}
  console.log('  ok synthetic xAPI outbox against HTTP mock: lost response, stable PUT, restart, conflict, rejection, retry, 4 processes, stale lease and isolation');
 } finally {try{repo.close();}catch{}await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
