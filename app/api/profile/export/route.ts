import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { makeProfileExport } from '@/lib/profile-export';

export const dynamic = 'force-dynamic';
/** A single consistent local snapshot. This endpoint is not a backup of provider data. */
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-export', auth.parentId), 10)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const id = new URL(req.url).searchParams.get('profileId');
  if (!id) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, id);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    // Экспорт — единственное место, где нужно всё состояние целиком: это
    // выгрузка данных профиля, и полнота здесь важнее стоимости чтения.
    const db = store.all();
    const data = makeProfileExport({ profile, ...db });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private', 'Content-Disposition': 'attachment; filename="gib-profile.json"', 'X-Content-Type-Options': 'nosniff' } });
  });
}
