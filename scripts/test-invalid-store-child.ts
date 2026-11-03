const { store } = await import('../lib/store.ts');
let failed = false;
try { store.all(); } catch { failed = true; }
if (!failed) throw new Error('Повреждённое хранилище не было отклонено');
export {};
