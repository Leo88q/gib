import { Worker } from 'node:worker_threads';
const sab = new SharedArrayBuffer(16 + 4 * 1024 * 1024);
const w = new Worker('/tmp/br/w.mjs', { workerData: { sab } });
const ctl = new Int32Array(sab, 0, 4), body = new Uint8Array(sab, 16);
function q(sql) {
  Atomics.store(ctl, 0, 0);
  w.postMessage({ sql });
  Atomics.wait(ctl, 0, 0, 30000);
  const state = Atomics.load(ctl, 0), len = Atomics.load(ctl, 1);
  const text = new TextDecoder().decode(body.subarray(0, len));
  if (state !== 1) throw new Error('worker: ' + text);
  return JSON.parse(text);
}
console.log('select:', q('select 42 as answer'));
console.log('create:', q('create table t (id int primary key, v text)'));
console.log('insert:', q("insert into t values (1,'привет')"));
console.log('read:', q('select * from t'));
w.terminate();
