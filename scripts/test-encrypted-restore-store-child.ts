process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = process.argv[2];
const { store } = await import('../lib/store.ts');
if (store.profile('p-test')?.name !== 'НЕ ДЛЯ ОТКРЫТОГО ФАЙЛА' || store.playerState('p-test').coins !== 42) throw new Error('restored state mismatch');
store.transaction(() => { const player = store.playerState('p-test'); player.coins++; store.setPlayerState(player); });
if (store.playerState('p-test').coins !== 43) throw new Error('restored store not writable');
export {};
