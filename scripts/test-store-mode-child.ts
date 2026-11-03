let rejected = false;
try { await import('../lib/store.ts'); } catch (error) { rejected = error instanceof Error && error.message === 'Unsupported GIB_STORE mode'; }
if (!rejected) throw Error('Unknown store mode silently accepted');
export {};
