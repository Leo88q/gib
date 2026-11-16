import { NextResponse } from 'next/server';
import { requestParent } from '@/lib/auth';
import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { clearParentGateCookieHeader } from '@/lib/parent-gate-cookie';
import {
  clearSessionCookieHeader,
  serializeSessionCookie,
  SESSION_TTL_MS,
} from '@/lib/session-cookie';
import { issueEmailOtp, verifyEmailOtp } from '@/lib/web-auth';

export const dynamic = 'force-dynamic';

/**
 * Управление серверной HttpOnly-сессией (`gib_session`):
 *  - GET  — проверка текущей сессии без раскрытия внутреннего `parentId`;
 *  - POST `action=exchange`           — обмен подписанного `initData` (Telegram/MAX) на 7-дневную HttpOnly-cookie
 *                                       (переживает возврат из ЮKassa и истечение 24-часового `initData`);
 *  - POST `action=request_email_code` — отправка 6-значного кода на почту для самостоятельного входа в браузере;
 *  - POST `action=verify_email_code`  — проверка кода из письма и выдача HttpOnly-сессии;
 *  - DELETE                           — выход и очистка сессионных cookies.
 */
export async function GET(req: Request) {
  const parentId = requestParent(req);
  if (!parentId) return NextResponse.json({ authenticated: false }, { status: 401 });
  const channel = parentId.startsWith('max:')
    ? 'max'
    : parentId.startsWith('web:')
      ? 'web'
      : parentId.startsWith('demo:')
        ? 'demo'
        : 'telegram';
  return NextResponse.json({ authenticated: true, channel });
}

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, 'auth-session'), 30)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { action?: unknown; email?: unknown; code?: unknown };

  if (body.action === 'exchange') {
    const parentId = requestParent(req);
    if (!parentId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const cookie = serializeSessionCookie(parentId);
    if (!cookie) return NextResponse.json({ error: 'session_not_configured' }, { status: 503 });
    const res = NextResponse.json({ ok: true, ttlMs: SESSION_TTL_MS });
    res.headers.append('Set-Cookie', cookie);
    return res;
  }

  if (body.action === 'request_email_code') {
    if (typeof body.email !== 'string') {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
    }
    const issued = await issueEmailOtp(body.email);
    if (!issued.ok) {
      const status = issued.error === 'invalid_email' ? 400 : 503;
      return NextResponse.json({ error: issued.error }, { status });
    }
    return NextResponse.json({
      ok: true,
      delivered: issued.delivered,
      expiresAt: issued.expiresAt,
      ...(issued.previewCode ? { previewCode: issued.previewCode } : {}),
    });
  }

  if (body.action === 'verify_email_code') {
    if (typeof body.email !== 'string' || typeof body.code !== 'string') {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 400 });
    }
    const parentId = verifyEmailOtp(body.email, body.code);
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

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', clearSessionCookieHeader());
  res.headers.append('Set-Cookie', clearParentGateCookieHeader());
  return res;
}
