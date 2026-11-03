import { DEFAULT_TIME_ZONE, isTimeZone } from '@/lib/calendar';
import { readJsonObject } from '@/lib/http-body';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { ensureSkills } from '@/lib/engine/session';
import { bandOf } from '@/lib/engine/adaptive';
import { requireParent, ownedProfile } from '@/lib/auth';
import { randomUUID } from 'node:crypto';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const { parentId } = auth;
  const profile = store.profileByParent(parentId);
  return NextResponse.json({ profile: profile ?? null });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-post', auth.parentId), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as {
    parentId?: string;
    name?: string;
    age?: number;
    initData?: string;
    timeZone?: string;
  };
  const { parentId } = auth;
  if (!Number.isInteger(body.age) || body.age! < 5 || body.age! > 13 || typeof body.name !== 'string' || body.name.trim().length > 24) return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
  if (body.timeZone !== undefined && !isTimeZone(body.timeZone)) return NextResponse.json({ error: 'invalid_time_zone' }, { status: 400 });
  const timeZone = body.timeZone ?? DEFAULT_TIME_ZONE;
  const age = body.age!;
  const name = body.name.trim() || 'Друг';
  return store.transaction(() => {
    const existing = store.profileByParent(parentId);
    if (existing) {
      ensureSkills(existing);
      return NextResponse.json({ profile: existing, created: false });
    }
    const profile: Profile = { id: 'p_' + randomUUID(), parentId, name, age, band: bandOf(age), timeZone, createdAt: Date.now() };
    store.addProfile(profile);
    ensureSkills(profile);
    return NextResponse.json({ profile, created: true });
  });
}

/** Parent-only change. Legacy attendance fields are preserved, not recalculated. */
export async function PATCH(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-update', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const { profileId, timeZone } = parsed.value;
  if (typeof profileId !== 'string' || !profileId || !isTimeZone(timeZone)) return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    profile.timeZone = timeZone;
    return NextResponse.json({ profile });
  });
}

/** Удаляет локальный профиль и прогресс; существующие резервные копии не изменяются. */
export async function DELETE(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-delete', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  return store.transaction(() => {
    if (!ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    if (store.payments(profileId).some(p => p.status === 'creating' || p.status === 'pending')) return NextResponse.json({ error: 'payment_in_progress' }, { status: 409 });
    store.deleteProfile(profileId);
    return NextResponse.json({ ok: true });
  });
}
