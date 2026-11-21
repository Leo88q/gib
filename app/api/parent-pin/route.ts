import { NextResponse } from 'next/server';
import { requireParent } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { readJsonObject } from '@/lib/http-body';
import { store } from '@/lib/store';
import {
  checkPin,
  hashPin,
  validPin,
  weakPin,
  MAX_PIN_ATTEMPTS,
  PARENT_SESSION_MS,
  PIN_LOCK_MS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from '@/lib/family/roles';
import {
  clearParentGateCookieHeader,
  serializeParentGateCookie,
  verifyParentGateCookie,
} from '@/lib/parent-gate-cookie';

export const dynamic = 'force-dynamic';

/**
 * PIN взрослого для входа в кабинет.
 *
 * GET    — нужен ли PIN и не заблокирован ли вход (без самого PIN).
 * POST   — `{ action: 'set', pin }` задать или заменить PIN,
 *          `{ action: 'verify', pin }` проверить PIN и открыть кабинет.
 * DELETE — удалить PIN (вход в кабинет снова свободный, как раньше).
 *
 * Это не аутентификация платформы и не проверка личности: PIN снижает риск,
 * что ребёнок откроет кабинет сам. Он не заменяет независимые роли и договор
 * с родителем — см. чек-лист.
 */
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  const pin = store.parentPin(auth.parentId);
  const now = Date.now();
  return NextResponse.json({
    configured: Boolean(pin),
    verified: pin ? verifyParentGateCookie(req, auth.parentId, now) : true,
    locked: Boolean(pin?.lockedUntil && pin.lockedUntil > now),
    retryAfterMs: pin?.lockedUntil && pin?.lockedUntil > now ? pin.lockedUntil - now : 0,
    minLength: PIN_MIN_LENGTH,
    maxLength: PIN_MAX_LENGTH,
    attempts: MAX_PIN_ATTEMPTS,
    lockMs: PIN_LOCK_MS,
    sessionMs: PARENT_SESSION_MS,
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'parent-pin', auth.parentId), 60)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (body.action !== 'set' && body.action !== 'verify') return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (Object.keys(body).some(key => !['action', 'pin', 'current'].includes(key))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (!validPin(body.pin)) return NextResponse.json({ error: 'invalid_pin_format' }, { status: 400 });

  return store.transaction(() => {
    const existing = store.parentPin(auth.parentId);
    const now = Date.now();

    if (body.action === 'set') {
      const pin = body.pin as string;
      if (weakPin(pin)) return NextResponse.json({ error: 'weak_pin' }, { status: 400 });
      // Сменить существующий PIN можно только зная текущий: иначе ребёнок,
      // один раз открывший кабинет, перезапишет код взрослого.
      if (existing) {
        if (typeof body.current !== 'string') return NextResponse.json({ error: 'current_required' }, { status: 400 });
        const current = checkPin(existing, body.current, now);
        if (!current.result.ok) {
          store.setParentPin(auth.parentId, current.next);
          return NextResponse.json({ error: current.result.reason === 'locked' ? 'pin_locked' : 'current_invalid' }, { status: current.result.reason === 'locked' ? 429 : 401 });
        }
      }
      store.setParentPin(auth.parentId, hashPin(pin));
      const res = NextResponse.json({ configured: true, verified: true, locked: false, retryAfterMs: 0 });
      res.headers.append('Set-Cookie', serializeParentGateCookie(auth.parentId, now));
      return res;
    }

    // verify
    if (!existing) return NextResponse.json({ error: 'no_pin' }, { status: 404 });
    const { result, next } = checkPin(existing, body.pin, now);
    store.setParentPin(auth.parentId, next);
    if (!result.ok) {
      const response = { error: result.reason === 'locked' ? 'pin_locked' : 'pin_invalid', retryAfterMs: result.reason === 'locked' ? result.retryAfterMs ?? 0 : 0 };
      return NextResponse.json(response, { status: result.reason === 'locked' ? 429 : 401 });
    }
    const res = NextResponse.json({ ok: true, sessionMs: PARENT_SESSION_MS });
    res.headers.append('Set-Cookie', serializeParentGateCookie(auth.parentId, now));
    return res;
  });
}

export async function DELETE(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'parent-pin-del', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });

  let currentPin: string | undefined;
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 0 || req.headers.get('content-type')?.includes('application/json')) {
    const parsed = await readJsonObject(req);
    if (parsed.ok && typeof parsed.value.current === 'string' && parsed.value.current.length > 0) {
      currentPin = parsed.value.current;
    }
  }

  return store.transaction(() => {
    const existing = store.parentPin(auth.parentId);
    if (!existing) return NextResponse.json({ error: 'no_pin' }, { status: 404 });

    const now = Date.now();
    if (currentPin !== undefined) {
      const checked = checkPin(existing, currentPin, now);
      if (!checked.result.ok) {
        store.setParentPin(auth.parentId, checked.next);
        return NextResponse.json(
          { error: checked.result.reason === 'locked' ? 'pin_locked' : 'current_invalid' },
          { status: checked.result.reason === 'locked' ? 429 : 401 },
        );
      }
    } else if (!verifyParentGateCookie(req, auth.parentId, now)) {
      const isLocalDemoReset = process.env.NODE_ENV !== 'production' && auth.parentId.startsWith('demo:');
      if (!isLocalDemoReset) {
        return NextResponse.json({ error: 'pin_verification_required' }, { status: 401 });
      }
    }

    store.removeParentPin(auth.parentId);
    const res = NextResponse.json({ configured: false });
    res.headers.append('Set-Cookie', clearParentGateCookieHeader());
    return res;
  });
}
