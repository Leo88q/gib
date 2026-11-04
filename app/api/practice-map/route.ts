import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { practiceMap } from '@/lib/engine/practice-map';
import { activityHistory, activitySummary } from '@/lib/engine/activity-history';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'practice-map', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  return store.transaction(() => {
    if (!ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const sessions = store.sessions(profileId);
    const profile = store.profile(profileId)!;
    const history = activityHistory(profile, sessions);
    return NextResponse.json({
      topics: practiceMap(profileId, sessions),
      // Занятость по дням: только факт занятия, без ответов и оценок.
      activity: { days: history, ...activitySummary(history) },
    });
  });
}
