import assert from 'node:assert/strict';
import { labBase,labDatabase } from './umami-lab-common';
const original={...process.env};
try{
 process.env.GIB_UMAMI_DISPOSABLE='1';Object.assign(process.env,{NODE_ENV:'test'});
 process.env.GIB_UMAMI_LAB_DATABASE_URL='postgresql://gib@127.0.0.1:55433/gib_umami_synthetic_lab';process.env.GIB_UMAMI_LAB_BASE='http://127.0.0.1:3096';
 assert.doesNotThrow(()=>labDatabase());assert.equal(labBase(),'http://127.0.0.1:3096');
 for(const url of ['postgresql://gib@localhost:55433/gib_umami_synthetic_lab','postgresql://gib@127.0.0.1:55433/umami','postgresql://gib@127.0.0.1:55433/gib_umami_synthetic_lab?sslmode=disable','postgresql://gib@127.0.0.1/gib_umami_synthetic_lab']){process.env.GIB_UMAMI_LAB_DATABASE_URL=url;assert.throws(()=>labDatabase());}
 for(const url of ['http://localhost:3096','https://127.0.0.1:3096','http://127.0.0.1:3096/path','http://user:pass@127.0.0.1:3096','http://127.0.0.1:3096/?x=1']){process.env.GIB_UMAMI_LAB_BASE=url;assert.throws(()=>labBase());}
 process.env.GIB_UMAMI_LAB_DATABASE_URL='postgresql://gib@127.0.0.1:55433/gib_umami_synthetic_lab';process.env.GIB_UMAMI_DISPOSABLE='0';assert.throws(()=>labDatabase());assert.throws(()=>labBase());process.env.GIB_UMAMI_DISPOSABLE='1';Object.assign(process.env,{NODE_ENV:'production'});assert.throws(()=>labDatabase());
 console.log('  ok Umami laboratory guards reject remote, production and non-disposable databases');
}finally {process.env=original;}
