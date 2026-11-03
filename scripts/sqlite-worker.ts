import { store } from '../lib/store.ts';
const id = 'sqlite-concurrency-test';
for (let i = 0; i < 50; i++) {
  store.transaction(() => {
    const player = store.playerState(id);
    player.coins++;
    store.setPlayerState(player);
  });
}
