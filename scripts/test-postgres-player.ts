import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { actOnOwnedPlayer, getOwnedPlayer } from '../lib/postgres/player-repository';

async function main() {
  const db = new PGlite(); const client: SqlClient = { query: async (sql, args) => db.query(sql, args) };
  const check = (v: unknown, label: string): void => { if (!v) throw Error(label); console.log('  ok', label); };
  try {
    await ensureSchema(client); await importLegacy(client, { profiles: [{ id: 'p', parentId: 'parent', name: 'Тест', age: 8, band: '8-10', createdAt: 1 }], sessions: [] });
    const denied = await getOwnedPlayer(client, 'other', 'p'); check('error' in denied && denied.error === 'profile_not_found', 'чужой игрок недоступен');
    const view = await getOwnedPlayer(client, 'parent', 'p');
    check(!('error' in view) && view.player.coins === 0 && view.missions.length === 3, 'игрок и миссии созданы');
    const poor = await actOnOwnedPlayer(client, 'parent', 'p', 'buy', 'head_cap'); check('error' in poor && poor.error === 'not_enough_coins', 'покупка без монет отклонена');
    const equip = await actOnOwnedPlayer(client, 'parent', 'p', 'equip', 'head_cap'); check('error' in equip && equip.error === 'not_owned', 'нельзя надеть чужой предмет');
    const player = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data as any;
    player.coins = 100; player.missions.ids = ['warmup']; player.missions.progress = { warmup: 3 }; player.missions.claimed = [];
    await client.query('UPDATE gib.player_states SET data=$1::jsonb WHERE profile_id=$2', [JSON.stringify(player), 'p']);
    const failing: SqlClient = { query: async (sql, args) => { if (sql.startsWith('UPDATE gib.player_states')) throw Error('injected failure'); return client.query(sql, args); } };
    let failed = false; try { await actOnOwnedPlayer(failing, 'parent', 'p', 'buy', 'head_cap'); } catch { failed = true; }
    check(failed && (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data && JSON.stringify((await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data) === JSON.stringify(player), 'сбой покупки откатывает монеты и предмет');
    const bought = await actOnOwnedPlayer(client, 'parent', 'p', 'buy', 'head_cap');
    check(!('error' in bought) && bought.player.coins === 60 && bought.player.equipped.head === 'head_cap', 'цена серверная, предмет куплен и надет');
    const again = await actOnOwnedPlayer(client, 'parent', 'p', 'buy', 'head_cap'); check('error' in again && again.error === 'already_owned', 'повторная покупка не списывает монеты');
    const claim = await actOnOwnedPlayer(client, 'parent', 'p', 'claim', 'warmup'); check(!('error' in claim) && claim.player.coins === 75, 'награда за выполненную миссию начислена');
    const retry = await actOnOwnedPlayer(client, 'parent', 'p', 'claim', 'warmup'); check('error' in retry && retry.error === 'not_ready', 'повторная выдача награды отклонена');
    const forbidden = await actOnOwnedPlayer(client, 'other', 'p', 'claim', 'warmup'); check('error' in forbidden && forbidden.error === 'profile_not_found', 'чужие награды недоступны');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
