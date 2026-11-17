import { NextResponse } from 'next/server';
import { ownedProfile, requireParent } from '@/lib/auth';
import { readJsonObject } from '@/lib/http-body';
import { verifyParentGateCookie } from '@/lib/parent-gate-cookie';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { DEFAULT_LESSON_REMINDER, findDueLessonReminder } from '@/lib/family/lesson-reminders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'notifications', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const profileId = new URL(req.url).searchParams.get('profileId') ?? '';
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const prog = store.programState(profile.id);
  const reminder = prog.lessonReminder ?? DEFAULT_LESSON_REMINDER;
  const upcoming = findDueLessonReminder({ ...reminder, enabled: true }, prog.lessons);

  return NextResponse.json({
    reminder,
    hasSchedule: Boolean(prog.lessons && prog.lessons.length > 0),
    upcoming,
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'notifications-write', auth.parentId), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  if (store.parentPin(auth.parentId) && !verifyParentGateCookie(req, auth.parentId)) {
    return NextResponse.json({ error: 'pin_verification_required' }, { status: 401 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { profileId, enabled } = parsed.value as { profileId?: unknown; enabled?: unknown };
  if (typeof profileId !== 'string' || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = store.transaction(() => {
    const prog = store.programState(profile.id);
    const prev = prog.lessonReminder ?? DEFAULT_LESSON_REMINDER;
    const next = {
      enabled,
      lastRemindedLesson: enabled ? prev.lastRemindedLesson : null,
      lastRemindedAt: enabled ? prev.lastRemindedAt : null,
    };
    store.setProgramState({ ...prog, lessonReminder: next });
    return next;
  });

  return NextResponse.json({ ok: true, reminder: updated });
}
