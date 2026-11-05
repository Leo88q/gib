import { parentPort, workerData } from 'node:worker_threads';
const ctl = new Int32Array(workerData.sab, 0, 4);
const body = new Uint8Array(workerData.sab, 16);
parentPort.on('message', async (msg) => {
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    workerData.db ??= await PGlite.create();
    const res = await workerData.db.query(msg.sql, msg.params);
    const bytes = new TextEncoder().encode(JSON.stringify(res.rows ?? []));
    body.set(bytes);
    Atomics.store(ctl, 1, bytes.length);
    Atomics.store(ctl, 0, 1);
    Atomics.notify(ctl, 0);
  } catch (e) {
    const bytes = new TextEncoder().encode(String(e));
    body.set(bytes); Atomics.store(ctl, 1, bytes.length); Atomics.store(ctl, 0, 2); Atomics.notify(ctl, 0);
  }
});
