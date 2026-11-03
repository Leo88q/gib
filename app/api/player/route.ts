import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { SHOP } from '@/lib/gamification';
import { publicPlayer } from '@/lib/engine/player-view';
import { buyItem, claimMission, ensureMissions } from '@/lib/engine/rewards';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'player', auth.parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (!ownedProfile(auth.parentId, profileId))
    return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  return store.transaction(() => NextResponse.json(publicPlayer(profileId)));
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'player', auth.parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as {
    profileId?: string;
    action?: 'claim' | 'buy' | 'equip';
    id?: string;
  };
  if (typeof body.profileId !== 'string' || !body.profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (!['claim', 'buy', 'equip'].includes(body.action ?? '') || typeof body.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.id)) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  const profileId = body.profileId;
  return store.transaction(() => {
  if (!ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  const player = store.playerState(profileId);
  const state = store.programState(profileId);
  if (!player.missions.ids.length) ensureMissions(player, state.completedDays);

  if (body.action === 'claim' && body.id) {
    const res = claimMission(player, body.id);
    if (!res) return NextResponse.json({ error: 'not_ready' }, { status: 400 });
    store.setPlayerState(player);
    return NextResponse.json({ ok: true, reward: res, ...publicPlayer(profileId) });
  }

  if (body.action === 'buy' && body.id) {
    const item = SHOP.find((i) => i.id === body.id);
    if (!item) return NextResponse.json({ error: 'unknown_item' }, { status: 404 });
    const res = buyItem(player, item.id, item.price);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    // новая вещь сразу надевается
    player.equipped = { ...player.equipped, [item.slot]: item.id };
    store.setPlayerState(player);
    return NextResponse.json({ ok: true, ...publicPlayer(profileId) });
  }

  if (body.action === 'equip' && body.id) {
    const item = SHOP.find((i) => i.id === body.id);
    if (!item) return NextResponse.json({ error: 'unknown_item' }, { status: 404 });
    if (!player.inventory.includes(item.id))
      return NextResponse.json({ error: 'not_owned' }, { status: 400 });
    player.equipped = { ...player.equipped, [item.slot]: item.id };
    store.setPlayerState(player);
    return NextResponse.json({ ok: true, ...publicPlayer(profileId) });
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  });
}
