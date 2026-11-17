import { createHmac, timingSafeEqual } from 'node:crypto';
import { PARENT_SESSION_MS } from './family/roles.ts';

export const PARENT_GATE_COOKIE = 'gib_parent_gate';

function gateSecret(): string {
  return (
    process.env.GIB_SESSION_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.MAX_BOT_TOKEN ||
    'gib-local-dev-parent-gate-secret'
  );
}

function sign(payloadB64: string): string {
  return createHmac('sha256', gateSecret()).update(payloadB64).digest('hex');
}

export function createParentGateToken(parentId: string, now = Date.now(), ttlMs = PARENT_SESSION_MS): string {
  const payload = Buffer.from(JSON.stringify({ parentId, exp: now + ttlMs }), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyParentGateToken(token: string | undefined, expectedParentId: string, now = Date.now()): boolean {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return false;
  const expectedSig = sign(payloadB64);
  if (!timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expectedSig, 'hex'))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      parentId?: unknown;
      exp?: unknown;
    };
    return parsed.parentId === expectedParentId && typeof parsed.exp === 'number' && parsed.exp > now;
  } catch {
    return false;
  }
}

export function readCookieFromHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return undefined;
}

export function verifyParentGateCookie(req: Request, parentId: string, now = Date.now()): boolean {
  const raw = readCookieFromHeader(req.headers.get('cookie'), PARENT_GATE_COOKIE);
  return verifyParentGateToken(raw, parentId, now);
}

export function serializeParentGateCookie(parentId: string, now = Date.now(), ttlMs = PARENT_SESSION_MS): string {
  const token = createParentGateToken(parentId, now, ttlMs);
  const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PARENT_GATE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearParentGateCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PARENT_GATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
