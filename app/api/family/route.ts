import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { advanceFamily, emptyFamily, publicFamily, type FamilyCommand } from '@/lib/engine/family';
import { familyGoal, familyGoalNotice } from '@/lib/engine/family-goal';

export const dynamic = 'force-dynamic';

/**
 * Цель считается по всем профилям владельца, но наружу отдаётся только общее число.
 * Разбивка по профилям не выходит за пределы этого модуля.
 */
function goalFor(parentId: string) {
  const profiles = store.profilesByParent(parentId);
  const confirmed = new Map<string, number>();
  for (const profile of profiles) {
    const state = store.all().playerStates.find(p => p.profileId === profile.id)?.family;
    confirmed.set(profile.id, state?.completed ?? 0);
  }
  const goal = familyGoal(profiles, confirmed);
  return { ...goal, notice: familyGoalNotice(goal) };
}
export async function GET(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'family', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const state = store.all().playerStates.find(p => p.profileId === profileId)?.family ?? emptyFamily();
    return NextResponse.json({ ...publicFamily(state, profile.band), goal: goalFor(auth.parentId) });
  });
}
export async function POST(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'family', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req); if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const b = parsed.value;
  if (typeof b.profileId !== 'string' || !b.profileId || !['choose','report','confirm','cancel','close'].includes(String(b.action)) || Object.keys(b).some(k => !['profileId','action','expectedVersion','operationId','ideaId'].includes(k))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  const command = { action: b.action, expectedVersion: b.expectedVersion, operationId: b.operationId, ...(b.ideaId !== undefined ? { ideaId: b.ideaId } : {}) } as FamilyCommand;
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, b.profileId as string);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const family = store.all().playerStates.find(p => p.profileId === profile.id)?.family ?? emptyFamily();
    const result = advanceFamily(family, command, randomUUID());
    if ('error' in result) return NextResponse.json(result, { status: result.error === 'invalid_action' ? 400 : 409 });
    if (!result.replay) { const player = store.playerState(profile.id); player.family = result.state; store.setPlayerState(player); }
    return NextResponse.json({ ...publicFamily(result.state, profile.band), goal: goalFor(auth.parentId), replay: result.replay });
  });
}
