export {};
/** Initialise a fresh, isolated PocketBase 0.22 instance with one synthetic record. */
const base=process.env.GIB_LAB_BASE ?? '';
const identity=process.env.GIB_LAB_ADMIN_EMAIL ?? '', password=process.env.GIB_LAB_ADMIN_PASSWORD ?? '';
if(process.env.NODE_ENV==='production' || process.env.GIB_POCKETBASE_DISPOSABLE!=='1' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(base) || !identity || !password) throw Error('isolated test configuration required');
async function main(){
 const call=async(path:string,method='GET',body?:object,token?:string)=>{
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:token}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(5000)});
  return {status:r.status,data:await r.json()};
 };
 const auth=await call('/api/admins/auth-with-password','POST',{identity,password});
 if(auth.status!==200 || typeof auth.data.token!=='string') throw Error('test admin authentication failed');
 const token:string=auth.data.token;
 const existing=await call('/api/collections/gib_lab_stories','GET',undefined,token);
 if(existing.status!==404) throw Error('lab collection already exists or could not be checked; use an empty disposable database');
 const collection=await call('/api/collections','POST',{name:'gib_lab_stories',type:'base',listRule:'',viewRule:null,createRule:null,updateRule:null,deleteRule:null,schema:[{name:'scenario_id',type:'text',required:true},{name:'title',type:'text',required:true}]},token);
 if(collection.status!==200) throw Error('test collection creation failed');
 const record=await call('/api/collections/gib_lab_stories/records','POST',{scenario_id:'lab_story_1',title:'Тестовая история 1'},token);
 if(record.status!==200) throw Error('test record creation failed; discard this disposable database');
 console.log('Synthetic read-only test collection created');
}
main().catch(()=>{console.error('PocketBase laboratory setup failed; use a new disposable database');process.exitCode=1});
