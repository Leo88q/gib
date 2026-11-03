/** Disposable PocketBase 0.22 laboratory only. Never point at data from people. */
import assert from 'node:assert/strict';
import { readSyntheticPocketBaseCatalog } from '../lib/experiments/local-connectors';
const base=process.env.GIB_LAB_BASE ?? '';
const identity=process.env.GIB_LAB_ADMIN_EMAIL ?? '', password=process.env.GIB_LAB_ADMIN_PASSWORD ?? '';
if (process.env.NODE_ENV==='production' || process.env.GIB_POCKETBASE_DISPOSABLE!=='1' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(base) || !identity || !password) throw Error('isolated test configuration required');
const phase=process.argv[2];
async function main(){
 const call=async(path:string,method='GET',body?:object,token?:string)=>{
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error'});
  return {status:r.status,data:r.status===204?null:await r.json()};
 };
 const auth=await call('/api/admins/auth-with-password','POST',{identity,password});
 assert.equal(auth.status,200,'test admin authentication failed'); const token:string=auth.data.token;
 const path='/api/collections/gib_lab_stories/records';
 const list=await readSyntheticPocketBaseCatalog(base);
 assert.deepEqual(list,[{scenarioId:'lab_story_1',title:'Тестовая история 1'}]);
 const records=await call(path+'?page=1&perPage=50'); assert.equal(records.status,200);assert.equal(records.data.items.length,1);
 const id=records.data.items[0].id;assert.equal(typeof id,'string');
 assert.equal((await call(path,'POST',{scenario_id:'lab_unauthorized',title:'Тестовая история 2'})).status,403);
 assert.equal((await call(`${path}/${id}`)).status,403); // view is private while the list is public
 assert.equal((await call(`${path}/${id}`,'PATCH',{title:'Тестовая история 2'})).status,403);
 assert.equal((await call(`${path}/${id}`,'DELETE')).status,403);
 if(phase==='prepare') {
  const made:string[]=[];
  try {
   const invalid=await call(path,'POST',{scenario_id:'lab_extra',title:'Not synthetic'},token);assert.equal(invalid.status,200);made.push(invalid.data.id);
   await assert.rejects(()=>readSyntheticPocketBaseCatalog(base),/invalid_lab_catalog/);
   assert.equal((await call(`${path}/${made[made.length-1]}`,'DELETE',undefined,token)).status,204);made.pop();
   const duplicate=await call(path,'POST',{scenario_id:'lab_story_1',title:'Тестовая история 2'},token);assert.equal(duplicate.status,200);made.push(duplicate.data.id);
   await assert.rejects(()=>readSyntheticPocketBaseCatalog(base),/invalid_lab_catalog/);
   assert.equal((await call(`${path}/${made[made.length-1]}`,'DELETE',undefined,token)).status,204);made.pop();
   for(let i=2;i<=51;i++) {const item=await call(path,'POST',{scenario_id:`lab_story_${i}`,title:`Тестовая история ${i}`},token);assert.equal(item.status,200);made.push(item.data.id);}
   await assert.rejects(()=>readSyntheticPocketBaseCatalog(base),/invalid_lab_catalog/);
  } finally {for(const recordId of made)assert.equal((await call(`${path}/${recordId}`,'DELETE',undefined,token)).status,204);}
  assert.deepEqual(await readSyntheticPocketBaseCatalog(base),list);
 } else if(phase!=='resume') throw Error('use prepare or resume');
 console.log(`  ok PocketBase 0.22: ${phase}, SDK, read-only rules, ownership-free denial, validation and persisted fixture`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
