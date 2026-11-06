import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { readJsonObject } from '@/lib/http-body';
import { store } from '@/lib/store';
import {
  familyGoal,
  familyGoalNotice,
  FAMILY_GOAL_MAX,
  FAMILY_GOAL_MIN,
  FAMILY_GOAL_STEP,
  validGoalTarget,
} from '@/lib/engine/family-goal';

export const dynamic = 'force-dynamic';

/**
 * Общая семейная цель: одно число на всю семью.
 *
 * Наружу уходят только подтверждённые отметки вместе по всем детям владельца,
 * размер цели и текстовое пояснение. Разбивки по профилям, имён и сравнения
 * нет: вклад одного ребёнка не должен становиться видимым другому.
 */
function response(parentId: string) {
  const profiles = store.profilesByParent(parentId);
  const confirmed = new Map<string, number>();
  for (const profile of profiles) {
    const family = store.playerState(profile.id).family;
    confirmed.set(profile.id, family?.completed ?? 0);
  }
  const target = store.familyGoalTarget(parentId) ?? undefined;
  const goal = familyGoal(profiles, confirmed, target);
  return NextResponse.json({
    goal: { ...goal, notice: familyGoalNotice(goal) },
    limits: { min: FAMILY_GOAL_MIN, max: FAMILY_GOAL_MAX, step: FAMILY_GOAL_STEP },
  });
}

export async function GET(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'family-goal', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  // profileId нужен только для проверки, что это взрослый этой семьи; на расчёт не влияет.
  if (profileId && !ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  return response(auth.parentId);
}

export async function POST(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'family-goal', auth.parentId), 60)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req); if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (Object.keys(body).some(k => !['profileId', 'target'].includes(k))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (typeof body.profileId !== 'string' || !body.profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (!validGoalTarget(body.target)) {
    return NextResponse.json({ error: 'invalid_target', min: FAMILY_GOAL_MIN, max: FAMILY_GOAL_MAX, step: FAMILY_GOAL_STEP }, { status: 400 });
  }
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, body.profileId as string);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    store.setFamilyGoalTarget(auth.parentId, body.target as number);
    return response(auth.parentId);
  });
}
