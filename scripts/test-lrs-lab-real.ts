/** Optional prepare/resume probe for a disposable, local real xAPI LRS. No game data. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dispatchSyntheticLrs, putSyntheticLrsStatement, SyntheticLrsOutbox, syntheticLrsPath, type LrsLabEndpoint } from '../lib/experiments/lrs-synthetic-outbox';
const phase=process.argv[2];
const rawBase=process.env.GIB_LRS_LAB_BASE??'', key=process.env.GIB_LRS_LAB_KEY??'', secret=process.env.GIB_LRS_LAB_SECRET??'', file=process.env.GIB_LRS_LAB_OUTBOX??'';
if(process.env.NODE_ENV==='production'||process.env.GIB_LRS_SYNTHETIC_LAB!=='1'||(phase!=='prepare'&&phase!=='resume'))throw Error('disposable synthetic laboratory and phase required');
const u=new URL(rawBase);if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('loopback only');
if(!path.isAbsolute(file)||path.basename(file)!=='gib-lrs-synthetic.sqlite'||!key||!secret||key.length>200||secret.length>200||key.includes(':')||/[\r\n]/.test(key+secret))throw Error('invalid synthetic lab configuration');
const endpoint=(process.env.GIB_LRS_LAB_ENDPOINT??'lowercase') as LrsLabEndpoint;
const endpointPath=syntheticLrsPath(endpoint);
const base=u.origin, headers={'X-Experience-API-Version':'1.0.3',Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`};
async function read(id:string){
 const res=await fetch(`${base}${endpointPath}?statementId=${id}`,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(res.status,200);const response=await res.json();
 // Ralph 5.1.0 FS returns a StatementResult even for statementId, unlike xAPI single-statement GET.
 const value=endpoint==='ralph' ? (assert.equal(response.statements?.length,1),response.statements[0]) : response;
 assert.equal(value.id,id);assert.deepEqual(value.actor.account,{homePage:'https://example.invalid',name:'synthetic-test'});assert.equal(value.verb.id,'http://adlnet.gov/expapi/verbs/completed');assert.equal(value.object.id,'https://example.invalid/gib-synthetic-activity');
}
async function conflict(id:string){
 const body={id,timestamp:'2020-01-01T00:00:00Z',actor:{objectType:'Agent',account:{homePage:'https://example.invalid',name:'synthetic-test'}},verb:{id:'http://adlnet.gov/expapi/verbs/completed'},object:{objectType:'Activity',id:'https://example.invalid/gib-different-synthetic-activity'}};
 const res=await fetch(`${base}${endpointPath}?statementId=${id}`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(res.status,409);
}
async function main(){
 if(phase==='prepare'){
  if(fs.existsSync(file))throw Error('prepare requires a fresh synthetic outbox');
  const outbox=new SyntheticLrsOutbox(file);try{const id=outbox.enqueue();assert.equal(await dispatchSyntheticLrs(outbox,base,key,secret,Date.now(),endpoint),'sent');await read(id);assert.equal(await putSyntheticLrsStatement(base,key,secret,id,endpoint),'accepted');await conflict(id);assert.equal(outbox.read(id)?.status,'sent');}
  finally{outbox.close();}
 } else {
  if(!fs.existsSync(file)||!fs.lstatSync(file).isFile())throw Error('existing synthetic outbox required');
  const outbox=new SyntheticLrsOutbox(file);try{
   const db=new DatabaseSync(file,{readOnly:true});let rows;try{rows=db.prepare('SELECT id,status FROM synthetic_lrs_outbox').all();}finally{db.close();}
   assert.equal(rows.length,1);assert.equal(rows[0].status,'sent');const id=String(rows[0].id);await read(id);assert.equal(await putSyntheticLrsStatement(base,key,secret,id,endpoint),'accepted');await conflict(id);assert.equal(await dispatchSyntheticLrs(outbox,base,key,secret,Date.now(),endpoint),'empty');
  }finally{outbox.close();}
 }
 console.log(`  ok local xAPI synthetic ${phase}: PUT, read, identical retry and conflicting ID`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'synthetic LRS check failed');process.exitCode=1});
