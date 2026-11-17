import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export function checkAdminToken(req: Request, env: NodeJS.ProcessEnv = process.env): NextResponse | null {
  const token = env.GIB_ADMIN_TOKEN;
  const header =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get('x-admin-token') ??
    '';
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(header.trim(), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}
