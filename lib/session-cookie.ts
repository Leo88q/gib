import { createHmac, timingSafeEqual } from 'node:crypto';
import { readCookieFromHeader } from './parent-gate-cookie.ts';

export const SESSION_COOKIE = 'gib_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.GIB_SESSION_SECRET || env.TELEGRAM_BOT_TOKEN || env.MAX_BOT_TOKEN;
  if (configured && configured.length >= 16) return configured;
  if (env.NODE_ENV === 'production') return null;
  return 'gib-local-dev-session-secret-key';
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('hex');
}

export function createSessionToken(
  parentId: string,
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ parentId, iat: now, exp: now + ttlMs }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!token || typeof token !== 'string') return null;
  const secret = sessionSecret(env);
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return null;
  const expected = signPayload(payloadB64, secret);
  if (!timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      parentId?: unknown;
      exp?: unknown;
    };
    if (
      typeof parsed.parentId !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,120}$/.test(parsed.parentId) ||
      typeof parsed.exp !== 'number' ||
      parsed.exp <= now
    ) {
      return null;
    }
    return parsed.parentId;
  } catch {
    return null;
  }
}

export function verifySessionCookie(req: Request, now = Date.now()): string | null {
  const raw = readCookieFromHeader(req.headers.get('cookie'), SESSION_COOKIE);
  return verifySessionToken(raw, now);
}

export function serializeSessionCookie(
  parentId: string,
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
): string | null {
  const token = createSessionToken(parentId, now, ttlMs);
  if (!token) return null;
  const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
