import { NextResponse } from 'next/server';
import { ownedProfile, requireParent } from '@/lib/auth';
import { readJsonObject } from '@/lib/http-body';
import { verifyParentGateCookie } from '@/lib/parent-gate-cookie';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { VIDEO_CONSENT_VERSION } from '@/lib/research/coding';
import { purgeProfileResearchLinks } from '@/lib/research/coding-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const profileId = new URL(req.url).searchParams.get('profileId') ?? '';
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const record = profile.videoConsent ?? null;
  return NextResponse.json({
    granted: Boolean(record?.granted),
    version: record?.version ?? VIDEO_CONSENT_VERSION,
    updatedAt: record?.updatedAt ?? null,
    revokedAt: record?.revokedAt ?? null,
    currentVersion: VIDEO_CONSENT_VERSION,
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-update', auth.parentId), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  if (store.parentPin(auth.parentId) && !verifyParentGateCookie(req, auth.parentId)) {
    return NextResponse.json({ error: 'pin_verification_required' }, { status: 401 });
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const { profileId, granted } = parsed.value as { profileId?: unknown; granted?: unknown };
  if (typeof profileId !== 'string' || typeof granted !== 'boolean') {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const now = Date.now();
  const result = store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return null;
    profile.videoConsent = {
      granted,
      version: VIDEO_CONSENT_VERSION,
      updatedAt: now,
      ...(granted ? {} : { revokedAt: now }),
    };
    return profile.videoConsent;
  });

  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const purgedSamples = granted ? 0 : purgeProfileResearchLinks(profileId);

  return NextResponse.json({
    ok: true,
    granted: result.granted,
    version: result.version,
    updatedAt: result.updatedAt,
    revokedAt: result.revokedAt ?? null,
    purgedSamples,
  });
}
