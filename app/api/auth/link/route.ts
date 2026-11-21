import { NextResponse } from 'next/server';
import { requestParent } from '@/lib/auth';
import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { serializeSessionCookie, SESSION_TTL_MS } from '@/lib/session-cookie';
import { issueDeviceLinkCode, redeemDeviceLinkCode } from '@/lib/web-auth';

export const dynamic = 'force-dynamic';

/**
 * Привязка обычного браузера (ноутбук, планшет, школьная доска) к аккаунту
 * взрослого/педагога по одноразовому 6-значному коду:
 *  - POST `action=create_code` — выдаёт одноразовый код на 10 минут для текущего аккаунта;
 *  - POST `action=redeem_code` — гасит код в браузере и ставит HttpOnly `gib_session`.
 */
export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, 'auth-link'), 20)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { action?: unknown; code?: unknown };

  if (body.action === 'create_code') {
    const parentId = requestParent(req);
    if (!parentId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const issued = issueDeviceLinkCode(parentId);
    return NextResponse.json({ ok: true, code: issued.code, expiresAt: issued.expiresAt });
  }

  if (body.action === 'redeem_code') {
    if (typeof body.code !== 'string') {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
    }
    const parentId = redeemDeviceLinkCode(body.code);
    if (!parentId) {
      return NextResponse.json({ error: 'invalid_or_expired_code' }, { status: 401 });
    }
    const cookie = serializeSessionCookie(parentId);
    if (!cookie) return NextResponse.json({ error: 'session_not_configured' }, { status: 503 });
    const res = NextResponse.json({ ok: true, ttlMs: SESSION_TTL_MS });
    res.headers.append('Set-Cookie', cookie);
    return res;
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
