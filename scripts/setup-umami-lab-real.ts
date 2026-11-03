/** Synthetic local DB only. Applies upstream v3.4.1 migration SQL without Prisma migrate. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { labDatabase, syntheticWebsite } from './umami-lab-common';
async function main(){
 const root=process.env.GIB_UMAMI_SOURCE_DIR;if(!root || !path.isAbsolute(root))throw Error('absolute Umami source required');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.name!=='umami'||pkg.version!=='3.4.1')throw Error('expected Umami 3.4.1');
 const dir=path.join(root,'prisma/migrations'), names=fs.readdirSync(dir).filter(name=>fs.statSync(path.join(dir,name)).isDirectory()).sort();
 const hash=crypto.createHash('sha256');const migrations=names.map(name=>{const sql=fs.readFileSync(path.join(dir,name,'migration.sql'));hash.update(name+'\0');hash.update(sql);return sql.toString();});
 if(names.length!==26 || hash.digest('hex')!=='1eb613bd7f644494625fc7d63df885b2772359c34bae28308a59e69a1455efb0')throw Error('unexpected migration source');
 const db=labDatabase();await db.connect();try{
  await db.query('BEGIN');const existing=await db.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') LIMIT 1");
  if(existing.rowCount)throw Error('database must be empty');
  for(const sql of migrations)await db.query(sql);
  await db.query('INSERT INTO website(website_id,name,domain) VALUES($1,$2,$3)',[syntheticWebsite,'synthetic lab','example.invalid']);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
 console.log('  ok disposable Umami 3.4.1 schema and synthetic website');
}
main().catch(e=>{console.error('Umami synthetic setup failed:',e instanceof Error?e.message:'unknown');process.exitCode=1});
