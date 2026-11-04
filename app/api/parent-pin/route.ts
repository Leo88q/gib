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
    locked: Boolean(pin?.lockedUntil && pin.lockedUntil > now),
    retryAfterMs: pin?.lockedUntil && pin.lockedUntil > now ? pin.lockedUntil - now : 0,
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

    if (body.action === 'set') {
      const pin = body.pin as string;
      if (weakPin(pin)) return NextResponse.json({ error: 'weak_pin' }, { status: 400 });
      // Сменить существующий PIN можно только зная текущий: иначе ребёнок,
      // один раз открывший кабинет, перезапишет код взрослого.
      if (existing) {
        if (typeof body.current !== 'string') return NextResponse.json({ error: 'current_required' }, { status: 400 });
        const current = checkPin(existing, body.current, Date.now());
        if (!current.result.ok) {
          store.setParentPin(auth.parentId, current.next);
          return NextResponse.json({ error: current.result.reason === 'locked' ? 'pin_locked' : 'current_invalid' }, { status: current.result.reason === 'locked' ? 429 : 401 });
        }
      }
      store.setParentPin(auth.parentId, hashPin(pin));
      return NextResponse.json({ configured: true, locked: false, retryAfterMs: 0 });
    }

    // verify
    if (!existing) return NextResponse.json({ error: 'no_pin' }, { status: 404 });
    const { result, next } = checkPin(existing, body.pin, Date.now());
    store.setParentPin(auth.parentId, next);
    if (!result.ok) {
      const response = { error: result.reason === 'locked' ? 'pin_locked' : 'pin_invalid', retryAfterMs: result.reason === 'locked' ? result.retryAfterMs ?? 0 : 0 };
      return NextResponse.json(response, { status: result.reason === 'locked' ? 429 : 401 });
    }
    return NextResponse.json({ ok: true, sessionMs: PARENT_SESSION_MS });
  });
}

export async function DELETE(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'parent-pin-del', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  return store.transaction(() => {
    if (!store.parentPin(auth.parentId)) return NextResponse.json({ error: 'no_pin' }, { status: 404 });
    store.removeParentPin(auth.parentId);
    return NextResponse.json({ configured: false });
  });
}
