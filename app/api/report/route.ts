import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { buildReport } from '@/lib/engine/session';
import { createStoreJournal } from '@/lib/events/store-journal';
import { buildEventReport } from '@/lib/events/report';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'report', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  // Отчёт по журналу событий: только завершённые занятия, с источниками и ограничениями.
  // Он дополняет существующий недельный отчёт, а не заменяет его.
  const events = buildEventReport(createStoreJournal(store), auth.parentId, profileId, { days: 7 });
  return NextResponse.json({ report: buildReport(profile), profile, events });
}
