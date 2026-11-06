import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { cleanStoryQuality } from '../lib/story-quality-cleanup.ts';
import { validateStore } from '../lib/store-validation.ts';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';
import { makeProfileExport } from '../lib/profile-export.ts';

const profile={id:'p',parentId:'owner',name:'Тест',age:9,band:'8-10',createdAt:1};
const makeAnswer=()=>({scenarioId:'w1d1',competency:'self_awareness',choice:0,quality:'bad'});
const receipt={step:3,fingerprint:'receipt-secret',result:{done:true,summary:{scenarioQuality:'bad',tasks:3,correct:2,stars:2,comboBest:1}}};
const snap={id:'w1d1',competency:'self_awareness',skillLabel:'Тема',variants:Object.fromEntries(['5-7','8-10','11-13'].map(b=>[b,{title:'История',text:'Ситуация',options:[{text:'Вариант',note:'Комментарий',quality:'bad'}]}]))};
const active={id:'active',profileId:'p',startedAt:1,seconds:0,tasks:[],plan:['scenario:w1d1'],runtime:{sessionId:'active',profileId:'p',index:0,plan:[{type:'scenario',scenarioId:'w1d1'}],items:[{type:'scenario',scenarioId:'w1d1',order:[0],content:snap}],storyVersions:{w1d1:snap},scenarioAnswer:makeAnswer()},lastReceipt:structuredClone(receipt)};
const completed={id:'finished',profileId:'p',startedAt:1,finishedAt:2,seconds:1,tasks:[],plan:['scenario:w1d1'],scenario:makeAnswer(),lastReceipt:structuredClone(receipt)};
const partial={id:'partial',profileId:'p',startedAt:1,seconds:0,tasks:[],plan:[],scenario:makeAnswer()};
const state={profiles:[profile],skills:[],sessions:[completed,active,partial],subs:[],programStates:[],playerStates:[],payments:[],extra:{keep:'quality:private-sentinel'}};
validateStore(state);

/* ---- 1. Живая миграция: метки уходят отовсюду ---- */
const original=structuredClone(state), transformed=cleanStoryQuality(state);
assert.deepEqual(state,original,'input remains untouched');
assert.deepEqual(transformed.counts,{
  finishedLabelsRemoved:1,   // ответ завершённой сессии
  activeLabelsRemoved:2,     // ответ в runtime активной сессии + строка без runtime
  activeLabelsDeferred:0,
  activeSnapshotsRemoved:1,  // items[] и storyVersions в одном заходе
  activeSnapshotsDeferred:0,
  receiptLabelsRemoved:2,    // обе квитанции
  receiptLabelsDeferred:0,
  sessionsChanged:3,
});
const result=transformed.state as any;
assert.ok(!('quality' in result.sessions[0].scenario));
assert.equal(result.sessions[0].lastReceipt.result.summary.scenarioQuality,undefined);
// Остальное в квитанции не тронуто: повтор отвечает тем же результатом.
assert.deepEqual(result.sessions[0].lastReceipt,{step:3,fingerprint:'receipt-secret',result:{done:true,summary:{tasks:3,correct:2,stars:2,comboBest:1}}});
assert.equal(result.sessions[1].scenario,undefined,'у активной сессии ответ живёт в runtime');
assert.ok(!('quality' in result.sessions[1].runtime.scenarioAnswer));
assert.ok(!JSON.stringify(result.sessions[1].runtime.items).includes('"quality"'));
assert.ok(!JSON.stringify(result.sessions[1].runtime.storyVersions).includes('"quality"'));
assert.ok(!('quality' in result.sessions[2].scenario),'строка без runtime тоже чистится');
assert.deepEqual(result.extra,state.extra,'чужие поля с текстом «quality:» не задеваются');
// Повторный прогон ничего не находит — миграция идемпотентна.
const twice=cleanStoryQuality(result);
assert.deepEqual(twice.counts,{finishedLabelsRemoved:0,activeLabelsRemoved:0,activeLabelsDeferred:0,activeSnapshotsRemoved:0,activeSnapshotsDeferred:0,receiptLabelsRemoved:0,receiptLabelsDeferred:0,sessionsChanged:0});
assert.deepEqual(twice.state,result);
validateStore(result);

/* ---- 2. Отложенный режим для снимка посреди занятия ---- */
const deferred=cleanStoryQuality(state,{deferActive:true});
assert.equal(deferred.counts.activeLabelsDeferred,2,'отложенный режим не трогает активную сессию и недостроенную строку');
assert.equal(deferred.counts.activeSnapshotsDeferred,1);
assert.equal(deferred.counts.finishedLabelsRemoved,1);
assert.equal(deferred.counts.receiptLabelsRemoved,2,'квитанции чистятся и в отложенном режиме');
assert.deepEqual((deferred.state as any).sessions[1],{...active,lastReceipt:{step:3,fingerprint:'receipt-secret',result:{done:true,summary:{tasks:3,correct:2,stars:2,comboBest:1}}}});

/* ---- 3. Чужие значения не трогаем ---- */
const odd={...state,sessions:[{id:'x',profileId:'p',startedAt:1,finishedAt:2,seconds:0,tasks:[],plan:[],scenario:{scenarioId:'w1d1',competency:'self_awareness',choice:0,quality:'отличное настроение'}}]};
const oddOut=cleanStoryQuality(odd);
assert.equal((oddOut.state as any).sessions[0].scenario.quality,'отличное настроение');

/* ---- 4. Выгрузка не выдаёт метку наружу ---- */
const exported=makeProfileExport({profile:profile as any,skills:[],sessions:result.sessions,programStates:[],playerStates:[],subs:[],payments:[]});
assert.ok(!JSON.stringify(exported.sessions[0].scenario).includes('"quality"'));
assert.ok(!JSON.stringify(exported.sessions[1].inProgress).includes('"quality"'));

/* ---- 5. CLI: превью, копия, повтор, защита исходника ---- */
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gib-scrub-test-'));
const src=path.join(dir,'source.sqlite'), out=path.join(dir,'copy.sqlite');
// CLI теперь общий для всех хранилищ; здесь проверяем именно SQLite-путь.
const child=(...args:string[])=>spawnSync('node_modules/.bin/tsx',['scripts/clean-story-quality.ts',...args],{encoding:'utf8',cwd:process.cwd()});
let db:DatabaseSync | undefined;
try {
 db=new DatabaseSync(src); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
 db.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify(state));
 const preview=child('--dry-run',src); assert.equal(preview.status,0,preview.stderr);
 assert.ok(preview.stdout.includes('"finishedLabelsRemoved": 1'));
 assert.ok(preview.stdout.includes('"receiptLabelsRemoved": 2'));
 assert.ok(!preview.stdout.includes('private-sentinel')); assert.ok(!preview.stdout.includes('receipt-secret'));
 assert.equal(db.prepare('SELECT data FROM app_state WHERE id=1').get()?.data,JSON.stringify(state));
 const apply=child('--copy',src,out); assert.equal(apply.status,0,apply.stderr); assert.equal(fs.statSync(out).mode & 0o777,0o600);
 verifySqliteSnapshot(out);
 const clone=new DatabaseSync(out,{readOnly:true}); const copy=JSON.parse(String(clone.prepare('SELECT data FROM app_state WHERE id=1').get()?.data));clone.close();
 assert.deepEqual(copy,result); assert.equal(db.prepare('SELECT data FROM app_state WHERE id=1').get()?.data,JSON.stringify(state));
 const again=child('--copy',src,out);assert.notEqual(again.status,0);verifySqliteSnapshot(out);
 assert.notEqual(child('--copy',src,src).status,0);
 const second=path.join(dir,'second.sqlite');const secondRun=child('--copy',out,second);assert.equal(secondRun.status,0,secondRun.stderr);
 assert.ok(secondRun.stdout.includes('"finishedLabelsRemoved": 0'));
 assert.ok(secondRun.stdout.includes('"receiptLabelsRemoved": 0'));
 // Invalid nested content must not publish a copy or alter the original.
 const bad=path.join(dir,'bad.sqlite'), badOut=path.join(dir,'bad-output.sqlite');
 const broken=new DatabaseSync(bad);broken.exec('CREATE TABLE app_state(id INTEGER PRIMARY KEY,data TEXT NOT NULL)');broken.prepare('INSERT INTO app_state VALUES(1,?)').run('{"profiles":[],"sessions":[null]}');broken.close();
 assert.notEqual(child('--copy',bad,badOut).status,0);assert.equal(fs.existsSync(badOut),false);
 // A database trigger can cause UPDATE to fail: no output is published.
 const fail=path.join(dir,'fail.sqlite'), failOut=path.join(dir,'fail-output.sqlite');
 const failing=new DatabaseSync(fail);failing.exec("CREATE TABLE app_state(id INTEGER PRIMARY KEY,data TEXT NOT NULL); CREATE TRIGGER deny_update BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'blocked'); END;");failing.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify(state));failing.close();
 assert.notEqual(child('--copy',fail,failOut).status,0);assert.equal(fs.existsSync(failOut),false);
 console.log('  ok живая миграция меток, идемпотентность, отложенный режим, выгрузка, копия и повтор');
} finally { db?.close(); fs.rmSync(dir,{recursive:true,force:true}); }
