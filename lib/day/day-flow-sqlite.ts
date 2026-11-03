import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { advanceDay, createDayFlow, type DayEvent, type DayFlow } from './day-flow.ts';
import { validateDayFlow } from './day-flow-validation.ts';
import type { AgeBand } from '../types.ts';
import type { StoryChoice } from './story-deck.ts';

/** Separate prototype database; not the game's store or a production repository. */
export class DayFlowSqlite {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    try { if (file !== ':memory:') fs.chmodSync(file, 0o600); } catch (error) { this.db.close(); throw error; }
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS day_flow (id TEXT PRIMARY KEY, owner TEXT NOT NULL, profile TEXT NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS day_flow_profile ON day_flow(owner,profile);`);
  }
  close() { this.db.close(); }
  private transaction<T>(fn:()=>T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private validIdentity(s: string) { return typeof s==='string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(s); }
  /** Caller must authenticate ownership and construct the offer server-side. */
  create(owner:string, profile:string, dayIndex:number, band:AgeBand, contentVersion:string, offer:StoryChoice[]) {
    if(!this.validIdentity(owner) || !this.validIdentity(profile)) throw Error('invalid_identity');
    const state=createDayFlow(dayIndex,band,contentVersion,offer); validateDayFlow(state);
    const id='df_'+randomUUID();
    this.transaction(()=>this.db.prepare('INSERT INTO day_flow(id,owner,profile,state) VALUES(?,?,?,?)').run(id,owner,profile,JSON.stringify(state)));
    return {id,state};
  }
  private load(owner:string,id:string): DayFlow | undefined {
    if(!this.validIdentity(owner) || !this.validIdentity(id)) return undefined;
    const row=this.db.prepare('SELECT state FROM day_flow WHERE owner=? AND id=?').get(owner,id) as {state:string}|undefined;
    if(!row) return undefined;
    let state:unknown; try {state=JSON.parse(row.state);}catch{throw Error('invalid_day_flow_state');}
    validateDayFlow(state); return state;
  }
  read(owner:string,id:string) { return this.load(owner,id); }
  advance(owner:string,id:string,operationId:string,version:number,event:DayEvent) {
    return this.transaction(()=>{
      const state=this.load(owner,id);
      if(!state) return {error:'not_found' as const};
      const result=advanceDay(state,operationId,version,event);
      if('error' in result || result.replay) return result;
      validateDayFlow(result.state);
      this.db.prepare('UPDATE day_flow SET state=? WHERE owner=? AND id=?').run(JSON.stringify(result.state),owner,id);
      return result;
    });
  }
  deleteProfile(owner:string,profile:string): number {
    if(!this.validIdentity(owner) || !this.validIdentity(profile)) throw Error('invalid_identity');
    return this.transaction(()=>Number(this.db.prepare('DELETE FROM day_flow WHERE owner=? AND profile=?').run(owner,profile).changes));
  }
}
