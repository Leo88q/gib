// Open a restored copy in a separate process through the actual store adapter.
process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = process.argv[2];
const { store } = await import('../lib/store.ts');
if (store.playerState('sqlite-concurrency-test').coins !== 200) throw new Error('Restored balance mismatch');
store.transaction(() => { const player = store.playerState('sqlite-concurrency-test'); player.coins++; store.setPlayerState(player); });
if (store.playerState('sqlite-concurrency-test').coins !== 201) throw new Error('Restored database not writable');
export {};
