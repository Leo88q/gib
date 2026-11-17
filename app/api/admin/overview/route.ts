import { NextResponse } from 'next/server';
import { checkAdminToken } from '@/lib/admin/auth';
import { buildAdminOverview } from '@/lib/admin/overview';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;
  if (!rateLimit(clientKey(req, 'admin-overview'), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const overview = await buildAdminOverview();
  return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } });
}
