import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Isolated, synthetic-only experiment. Not an application event pipeline. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validTime=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=8_640_000_000_000_000;
const guard=()=>{if(process.env.NODE_ENV==='production'||process.env.GIB_LRS_SYNTHETIC_LAB!=='1')throw Error('synthetic_lab_disabled');};
function origin(input:string):string {
 guard();const u=new URL(input);
 if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('loopback_only');
 return u.origin;
}
function statement(id:string){
 if(!UUID.test(id))throw Error('invalid_statement_id');
 return {id,timestamp:'2020-01-01T00:00:00Z',actor:{objectType:'Agent',account:{homePage:'https://example.invalid',name:'synthetic-test'}},verb:{id:'http://adlnet.gov/expapi/verbs/completed'},object:{objectType:'Activity',id:'https://example.invalid/gib-synthetic-activity'}};
}
export type LrsLabEndpoint = 'lowercase'|'ralph';
export function syntheticLrsPath(endpoint:LrsLabEndpoint):string {
 if(endpoint==='lowercase')return '/xapi/statements';
 if(endpoint==='ralph')return '/xAPI/statements';
 throw Error('invalid_lab_endpoint');
}
/** PUT allows an identical statement ID/body to be safely retried only on conformant LRSs. */
export async function putSyntheticLrsStatement(base:string,key:string,secret:string,id:string,endpoint:LrsLabEndpoint='lowercase'):Promise<'accepted'|'conflict'|'rejected'> {
 const host=origin(base);const body=statement(id);
 if(!key||!secret||key.length>200||secret.length>200||key.includes(':')||/[\r\n]/.test(key+secret))throw Error('invalid_lab_credentials');
 const response=await fetch(`${host}${syntheticLrsPath(endpoint)}?statementId=${id}`,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','X-Experience-API-Version':'1.0.3',Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`},body:JSON.stringify(body)});
 if(response.status===204)return 'accepted';
 if(response.status===409)return 'conflict';
 // Do not retry invalid credentials, payloads, or unexpected success responses forever.
 if((response.status>=400 && response.status<500 && response.status!==408 && response.status!==429) || (response.status>=200 && response.status<300)) return 'rejected';
 throw Error(`lrs_put_http_${response.status}`);
}
export type Lease={id:string;token:string;attempts:number};
export class SyntheticLrsOutbox {
 private db:DatabaseSync;
 constructor(file:string){
  guard();
  if(file!==':memory:'){
   if(!path.isAbsolute(file)||path.basename(file)!=='gib-lrs-synthetic.sqlite')throw Error('invalid_lab_database');
   try { const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd); }
   catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('invalid_lab_database');}
  }
  this.db=new DatabaseSync(file);
  try{
   this.db.exec('PRAGMA busy_timeout=5000;');
   const existing=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   const appId=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
   const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
   if(existing.length ? (existing.length!==1 || existing[0].name!=='synthetic_lrs_outbox' || appId!==0x4749424c || version!==2) : (appId!==0 || version!==0))throw Error('invalid_lab_database');
   if(file!==':memory:')fs.chmodSync(file,0o600);
   this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
   this.db.exec(`CREATE TABLE IF NOT EXISTS synthetic_lrs_outbox (
    id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pending','leased','sent','conflict','rejected')),
    attempts INTEGER NOT NULL CHECK(attempts>=0), due INTEGER NOT NULL CHECK(due>=0), token TEXT, lease_until INTEGER,
    CHECK ((status='leased' AND token IS NOT NULL AND lease_until IS NOT NULL) OR (status!='leased' AND token IS NULL AND lease_until IS NULL))
   ); PRAGMA application_id=1195983436; PRAGMA user_version=2;`);
  }catch(e){this.db.close();throw e;}
 }
 close(){this.db.close();}
 private tx<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 /** Always emits the same fixed test actor, verb and activity; no user content is accepted. */
 enqueue(now=Date.now()):string {
  guard();if(!validTime(now))throw Error('invalid_time');const id=randomUUID();this.db.prepare("INSERT INTO synthetic_lrs_outbox VALUES (?, 'pending', 0, ?, NULL, NULL)").run(id,now);return id;
 }
 reserve(now=Date.now(),leaseMs=30_000):Lease|null {
  guard();if(!validTime(now)||!Number.isSafeInteger(leaseMs)||leaseMs<500||leaseMs>60_000||!validTime(now+leaseMs))throw Error('invalid_time');
  return this.tx(()=>{
   const row=this.db.prepare("SELECT id,attempts FROM synthetic_lrs_outbox WHERE (status='pending' AND due<=?) OR (status='leased' AND lease_until<=?) ORDER BY due,id LIMIT 1").get(now,now) as {id:string;attempts:number}|undefined;
   if(!row)return null;if(!UUID.test(row.id)||!Number.isSafeInteger(row.attempts)||row.attempts<0||row.attempts>=1_000_000)throw Error('invalid_outbox_state');
   const token=randomUUID();this.db.prepare("UPDATE synthetic_lrs_outbox SET status='leased', token=?, lease_until=?, attempts=attempts+1 WHERE id=?").run(token,now+leaseMs,row.id);
   return {id:row.id,token,attempts:row.attempts+1};
  });
 }
 /** A stale worker cannot overwrite the result of a newer lease. */
 finish(lease:Lease,result:'accepted'|'conflict'|'rejected'|'retry',now=Date.now()):boolean {
  guard();if(!UUID.test(lease.id)||!UUID.test(lease.token)||!Number.isSafeInteger(lease.attempts)||lease.attempts<1||lease.attempts>1_000_000||!validTime(now)||!['accepted','conflict','rejected','retry'].includes(result))throw Error('invalid_lease');
  const status=result==='accepted'?'sent':result==='conflict'?'conflict':result==='rejected'?'rejected':'pending';const due=result==='retry'?now+Math.min(60_000,1000*2**Math.min(lease.attempts-1,6)):now;
  if(!validTime(due))throw Error('invalid_time');
  return Number(this.db.prepare('UPDATE synthetic_lrs_outbox SET status=?, due=?, token=NULL, lease_until=NULL WHERE id=? AND status=\'leased\' AND token=? AND attempts=?').run(status,due,lease.id,lease.token,lease.attempts).changes)===1;
 }
 read(id:string){guard();if(!UUID.test(id))throw Error('invalid_statement_id');return this.db.prepare('SELECT id,status,attempts,due,token,lease_until FROM synthetic_lrs_outbox WHERE id=?').get(id);}
}
/** Sends a reserved test statement. Unknown outcomes stay retryable; never infer success from timeout. */
export async function dispatchSyntheticLrs(outbox:SyntheticLrsOutbox,base:string,key:string,secret:string,now=Date.now(),endpoint:LrsLabEndpoint='lowercase'):Promise<'empty'|'sent'|'conflict'|'rejected'|'retry'|'stale'> {
 // Fail before acquiring a lease for obviously invalid configuration.
 origin(base);syntheticLrsPath(endpoint);if(!key||!secret||key.length>200||secret.length>200||key.includes(':')||/[\r\n]/.test(key+secret))throw Error('invalid_lab_credentials');
 const lease=outbox.reserve(now);if(!lease)return 'empty';let result:'accepted'|'conflict'|'rejected'|'retry';
 try{result=await putSyntheticLrsStatement(base,key,secret,lease.id,endpoint);}catch{result='retry';}
 if(!outbox.finish(lease,result,Math.max(now,Date.now())))return 'stale';
 return result==='accepted'?'sent':result;
}
