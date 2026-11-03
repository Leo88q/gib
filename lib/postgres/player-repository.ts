import { SHOP } from '../gamification';
import { buyItem, claimMission, ensureMissions } from '../engine/rewards';
import { publicPlayer } from '../engine/player-view';
import type { Profile } from '../types';
import type { SqlClient } from './migrate';
import { makeSessionMemory } from './session-memory';
import { persist, snapshot, transaction } from './session-repository';

type PlayerAction = 'claim' | 'buy' | 'equip';
/** Experimental; the caller must dedicate one connection for the entire operation. */
export async function getOwnedPlayer(client: SqlClient, parentId: string, profileId: string) {
  if (!parentId || !profileId) return { error: 'invalid_request' } as const;
  return transaction(client, async () => {
    const rows = await client.query('SELECT data FROM gib.profiles WHERE id=$1 AND parent_id=$2 FOR UPDATE', [profileId, parentId]);
    if (!rows.rows.length) return { error: 'profile_not_found' } as const;
    const before = await snapshot(client, rows.rows[0].data as Profile);
    const working = makeSessionMemory(before);
    const result = publicPlayer(profileId, working.store);
    await persist(client, before, working.state);
    return result;
  });
}

/** Prices and ownership are checked server-side under the same lock as session rewards. */
export async function actOnOwnedPlayer(client: SqlClient, parentId: string, profileId: string, action: PlayerAction, id: string) {
  if (!parentId || !profileId || !['claim','buy','equip'].includes(action) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return { error: 'invalid_action' } as const;
  return transaction(client, async () => {
    const rows = await client.query('SELECT data FROM gib.profiles WHERE id=$1 AND parent_id=$2 FOR UPDATE', [profileId, parentId]);
    if (!rows.rows.length) return { error: 'profile_not_found' } as const;
    const before = await snapshot(client, rows.rows[0].data as Profile);
    const working = makeSessionMemory(before);
    const player = working.store.playerState(profileId);
    const program = working.store.programState(profileId);
    if (!player.missions.ids.length) ensureMissions(player, program.completedDays);
    let reward;
    if (action === 'claim') {
      reward = claimMission(player, id);
      if (!reward) return { error: 'not_ready' } as const;
    } else {
      const item = SHOP.find(i => i.id === id);
      if (!item) return { error: 'unknown_item' } as const;
      if (action === 'buy') {
        const result = buyItem(player, item.id, item.price);
        if (!result.ok) return { error: result.error ?? 'invalid_action' };
      } else if (!player.inventory.includes(item.id)) return { error: 'not_owned' } as const;
      player.equipped = { ...player.equipped, [item.slot]: item.id };
    }
    working.store.setPlayerState(player);
    const view = publicPlayer(profileId, working.store);
    await persist(client, before, working.state);
    return { ok: true as const, ...(reward ? { reward } : {}), ...view };
  });
}
