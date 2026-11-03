import { verifyInitData } from './telegram.ts';

/**
 * Experimental verifier; not wired to HTTP authentication.
 * MAX documents the same HMAC construction as Telegram, but requires its own
 * bot token. Never accept an unverified client user ID or merge platform IDs.
 * https://dev.max.ru/docs/webapps/validation
 */
export function verifyMaxInitData(initData: string, maxBotToken: string | undefined, now = Date.now()):
  { ok: true; platform: 'max'; subject: string } | { ok: false } {
  if (typeof initData !== 'string' || !Number.isFinite(now) || now <= 0) return { ok: false };
  const verified = verifyInitData(initData, maxBotToken, now);
  if (!verified.ok || !verified.user) return { ok: false };
  // MAX Bridge recommends a one-hour validity period.
  const authDate = new URLSearchParams(initData).get('auth_date');
  if (!authDate || !/^\d{1,12}$/.test(authDate) || now / 1000 - Number(authDate) > 3600) return { ok: false };
  return { ok: true, platform: 'max', subject: `max:${verified.user.id}` };
}
