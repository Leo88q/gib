import { BADGES, SHOP, levelOf, xpToNext } from '../gamification';
import { store } from '../store';
import { ensureMissions, missionViews } from './rewards';
import type { SessionStore } from './session';

/** Shared view: pass an isolated store inside the PostgreSQL transaction. */
export function publicPlayer(profileId: string, context: SessionStore = store) {
  const player = context.playerState(profileId);
  const state = context.programState(profileId);
  if (!player.missions.ids.length) ensureMissions(player, state.completedDays);
  const lvl = levelOf(player.xp);
  const prog = xpToNext(player.xp);
  return {
    player: {
      xp: player.xp, coins: player.coins, stars: player.stars,
      level: lvl.level, levelTitle: lvl.title, xpInLevel: prog.current, xpNeed: prog.need, xpPercent: prog.percent,
      badges: player.badges, inventory: player.inventory, equipped: player.equipped, stats: player.stats,
    },
    missions: missionViews(player),
    badges: BADGES.map(b => ({ id: b.id, title: b.title, desc: b.desc, glyph: b.glyph, tier: b.tier, unlocked: player.badges.includes(b.id) })),
    shop: SHOP,
  };
}
