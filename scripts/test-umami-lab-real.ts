/** Verify actual synthetic event ingestion and SQL persistence across Umami restarts. */
import assert from 'node:assert/strict';
import { sendSyntheticUmamiProbe } from '../lib/experiments/local-connectors';
import { labBase, labDatabase, syntheticWebsite } from './umami-lab-common';
async function main(){
 const phase=process.argv[2];if(phase!=='prepare'&&phase!=='resume')throw Error('prepare or resume required');
 const base=labBase(),db=labDatabase();await db.connect();try{
  const count=async()=>{const r=await db.query('SELECT event_name,url_path FROM website_event WHERE website_id=$1 ORDER BY created_at',[syntheticWebsite]);for(const row of r.rows)assert.deepEqual(row,{event_name:'gib_synthetic_probe',url_path:'/synthetic-test'});return r.rows.length;};
  assert.equal(await count(),phase==='prepare'?0:1);
  // Warm the server without creating an event; a dev server's initial compile may exceed probe timeout.
  const warm=await fetch(`${base}/api/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(90_000)});assert.ok(warm.status>=400 && warm.status<500);
  await sendSyntheticUmamiProbe(base,syntheticWebsite);assert.equal(await count(),phase==='prepare'?1:2);
  console.log(`  ok real Umami synthetic event ${phase}: accepted and persisted`);
 }finally{await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
