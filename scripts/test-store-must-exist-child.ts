process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = process.argv[2];
process.env.GIB_SQLITE_MUST_EXIST = '1';
const { store } = await import('../lib/store.ts');
let ok = true;
try { store.all(); } catch { ok = false; }
if (ok !== (process.argv[3] === 'valid')) throw new Error('unexpected existing-store outcome');
export {};
