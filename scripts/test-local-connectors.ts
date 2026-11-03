import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readSyntheticPocketBaseCatalog, sendSyntheticLrsProbe, sendSyntheticUmamiProbe } from '../lib/experiments/local-connectors';
async function main() {
 const requests: {url:string;body:string;authorization?:string;version?:string}[]=[];
 let catalog: unknown = {page:1,perPage:50,totalItems:1,totalPages:1,items:[{id:'x',scenario_id:'lab_story_1',title:'Тестовая история 1'}]};
 let redirect=false; let lrsReceiptValid=true;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[]; for await(const c of req)chunks.push(Buffer.from(c));
  requests.push({url:req.url!,body:Buffer.concat(chunks).toString(),authorization:req.headers.authorization,version:req.headers['x-experience-api-version'] as string|undefined});
  if(redirect) {res.statusCode=302;res.setHeader('location','http://example.com');return res.end();}
  res.setHeader('content-type','application/json');
  if(req.url!.startsWith('/api/collections/gib_lab_stories/records')) return res.end(JSON.stringify(catalog));
  if(req.url==='/xapi/statements') {res.statusCode=200;return res.end(JSON.stringify(lrsReceiptValid ? [JSON.parse(requests[requests.length-1].body).id] : []));}
  if(req.url==='/api/send') return res.end('{}');
  res.statusCode=404;res.end('{}');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try {
  assert.deepEqual(await readSyntheticPocketBaseCatalog(base),[{scenarioId:'lab_story_1',title:'Тестовая история 1'}]);
  const id=await sendSyntheticLrsProbe(base,'key','secret');assert.match(id,/^[0-9a-f-]{36}$/);
  const lrs=requests.find(x=>x.url==='/xapi/statements')!;assert.equal(lrs.version,'1.0.3');assert.equal(lrs.authorization,'Basic a2V5OnNlY3JldA==');assert.equal(JSON.parse(lrs.body).id,id);
  await sendSyntheticUmamiProbe(base,'123e4567-e89b-42d3-a456-426614174000'); const umami=requests.find(x=>x.url==='/api/send')!;
  assert.deepEqual(Object.keys(JSON.parse(umami.body).payload).sort(),['hostname','name','url','website']);
  for(const url of ['http://localhost:3333','https://127.0.0.1:443','http://example.com:80','http://127.0.0.1:123/a','http://u:p@127.0.0.1:80']) await assert.rejects(()=>sendSyntheticUmamiProbe(url,'123e4567-e89b-42d3-a456-426614174000'));
  for(const bad of [
   {page:1,perPage:50,totalItems:1,totalPages:1,items:[{scenario_id:'../escape',title:'Тестовая история 1'}]},
   {page:1,perPage:50,totalItems:1,totalPages:1,items:[{scenario_id:'lab_ok',title:'Имя ребёнка'}]},
   {page:1,perPage:50,totalItems:2,totalPages:1,items:[{scenario_id:'lab_same',title:'Тестовая история 1'},{scenario_id:'lab_same',title:'Тестовая история 2'}]},
   {page:1,perPage:50,totalItems:51,totalPages:2,items:[]},
   {page:1,perPage:50,totalItems:1,items:[]},
   {page:2,perPage:50,totalItems:1,totalPages:1,items:[{scenario_id:'lab_ok',title:'Тестовая история 1'}]},
  ]) { catalog=bad; await assert.rejects(()=>readSyntheticPocketBaseCatalog(base),/invalid_lab_catalog/); }
  await assert.rejects(()=>sendSyntheticLrsProbe(base,'bad:key','secret'),/invalid_lab_credentials/);
  lrsReceiptValid=false; await assert.rejects(()=>sendSyntheticLrsProbe(base,'key','secret'),/invalid_lrs_receipt/); lrsReceiptValid=true;
  await assert.rejects(()=>sendSyntheticUmamiProbe(base,'not-a-uuid'),/invalid_lab_website/);
  redirect=true;
  await assert.rejects(()=>sendSyntheticUmamiProbe(base,'123e4567-e89b-42d3-a456-426614174000'));
  await assert.rejects(()=>sendSyntheticLrsProbe(base,'key','secret'));
  await assert.rejects(()=>readSyntheticPocketBaseCatalog(base));
  redirect=false;
  const env=process.env as Record<string,string|undefined>;const prev=env.NODE_ENV;env.NODE_ENV='production';try{await assert.rejects(()=>readSyntheticPocketBaseCatalog(base),/laboratory_disabled/);}finally{if(prev===undefined) delete env.NODE_ENV;else env.NODE_ENV=prev;}
  console.log('  ok PocketBase SDK, xAPI/SQL LRS and Umami synthetic probes against local HTTP mocks; external and production denied');
 } finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
