import { Client } from 'pg';

/** Tests must never connect to application data or non-loopback servers. */
export const syntheticWebsite='c8ce0c2d-91b9-4051-875e-22e98a60ef1a';
export function labDatabase(): Client {
 if(process.env.NODE_ENV==='production'||process.env.GIB_UMAMI_DISPOSABLE!=='1')throw Error('disposable lab required');
 const u=new URL(process.env.GIB_UMAMI_LAB_DATABASE_URL ?? '');
 if(u.protocol!=='postgresql:' || u.hostname!=='127.0.0.1' || !u.port || u.pathname!=='/gib_umami_synthetic_lab' || u.search || u.hash)throw Error('disposable loopback database required');
 return new Client({connectionString:u.toString(),connectionTimeoutMillis:5000});
}
export function labBase():string {
 if(process.env.NODE_ENV==='production'||process.env.GIB_UMAMI_DISPOSABLE!=='1')throw Error('disposable lab required');
 const u=new URL(process.env.GIB_UMAMI_LAB_BASE ?? '');
 if(u.protocol!=='http:' || u.hostname!=='127.0.0.1' || !u.port || u.pathname!=='/' || u.username || u.password || u.search || u.hash)throw Error('loopback umami required');
 return u.origin;
}
