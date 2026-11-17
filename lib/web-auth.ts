import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { storeModeOf } from './store-mode.ts';
import { ensureSchemaSync, openBridge } from './postgres/state-backend.ts';
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from './postgres/schema.ts';
import { validEmail } from './billing/receipt.ts';

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

type ChallengeRow = {
  id: string;
  kind: 'device_link' | 'email_otp';
  codeHash: string;
  target: string;
  expiresAt: number;
  attempts: number;
  usedAt: number | null;
};

const memoryChallenges = new Map<string, ChallengeRow>();
let pgSchemaChecked = false;

function challengeSecret(): string {
  return (
    process.env.GIB_SESSION_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.MAX_BOT_TOKEN ||
    'gib-local-dev-challenge-secret'
  );
}

function hashCode(kind: string, scope: string, code: string): string {
  return createHmac('sha256', challengeSecret())
    .update(`${kind}:${scope}:${code}`)
    .digest('hex');
}

function generateSixDigits(): string {
  return String(randomInt(100_000, 1_000_000));
}

function pgBridgeIfEnabled() {
  if (storeModeOf() !== 'postgres') return null;
  const bridge = openBridge();
  if (!pgSchemaChecked) {
    ensureSchemaSync(bridge, { v1: SCHEMA_V1, v2: SCHEMA_V2, v3: SCHEMA_V3 });
    pgSchemaChecked = true;
  }
  return bridge;
}

export function parentIdForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `web:${digest}`;
}

/**
 * Создаёт одноразовый 6-значный код привязки браузера к существующему аккаунту
 * (Telegram, MAX или веб). Действует 10 минут.
 */
export function issueDeviceLinkCode(parentId: string, now = Date.now()): { code: string; expiresAt: number } {
  const code = generateSixDigits();
  const expiresAt = now + CHALLENGE_TTL_MS;
  const codeHash = hashCode('device_link', 'global', code);
  const id = `dl_${randomUUID()}`;

  const bridge = pgBridgeIfEnabled();
  if (bridge) {
    bridge.query('DELETE FROM gib.auth_challenges WHERE expires_at <= $1 OR used_at IS NOT NULL', [now]);
    bridge.query(
      `INSERT INTO gib.auth_challenges (id, kind, code_hash, target, expires_at, attempts, used_at)
       VALUES ($1, 'device_link', $2, $3, $4, 0, NULL)`,
      [id, codeHash, parentId, expiresAt],
    );
  } else {
    for (const [k, row] of memoryChallenges) {
      if (row.expiresAt <= now || row.usedAt !== null) memoryChallenges.delete(k);
    }
    memoryChallenges.set(id, {
      id,
      kind: 'device_link',
      codeHash,
      target: parentId,
      expiresAt,
      attempts: 0,
      usedAt: null,
    });
  }

  return { code, expiresAt };
}

/** Проверяет и атомарно гасит одноразовый 6-значный код привязки устройства. */
export function redeemDeviceLinkCode(rawCode: string, now = Date.now()): string | null {
  const code = rawCode.replace(/\s|-/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const expectedHash = hashCode('device_link', 'global', code);

  const bridge = pgBridgeIfEnabled();
  if (bridge) {
    const rows = bridge.query(
      `UPDATE gib.auth_challenges
       SET used_at = $1
       WHERE kind = 'device_link' AND code_hash = $2 AND used_at IS NULL AND expires_at > $1
       RETURNING target`,
      [now, expectedHash],
    );
    return rows.length > 0 ? String(rows[0].target) : null;
  }

  for (const row of memoryChallenges.values()) {
    if (row.kind !== 'device_link' || row.usedAt !== null || row.expiresAt <= now) continue;
    if (timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
      row.usedAt = now;
      return row.target;
    }
  }
  return null;
}

/** Создаёт 6-значный одноразовый код для входа по почте в обычном браузере. */
export async function issueEmailOtp(
  rawEmail: string,
  now = Date.now(),
  transport: typeof fetch = fetch,
): Promise<{ ok: true; delivered: 'webhook' | 'dev_preview'; previewCode?: string; expiresAt: number } | { ok: false; error: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: 'invalid_email' };

  const code = generateSixDigits();
  const expiresAt = now + CHALLENGE_TTL_MS;
  const codeHash = hashCode('email_otp', email, code);
  const id = `eo_${email}`;

  const bridge = pgBridgeIfEnabled();
  if (bridge) {
    bridge.query(
      `INSERT INTO gib.auth_challenges (id, kind, code_hash, target, expires_at, attempts, used_at)
       VALUES ($1, 'email_otp', $2, $3, $4, 0, NULL)
       ON CONFLICT (id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         used_at = NULL`,
      [id, codeHash, email, expiresAt],
    );
  } else {
    memoryChallenges.set(id, {
      id,
      kind: 'email_otp',
      codeHash,
      target: email,
      expiresAt,
      attempts: 0,
      usedAt: null,
    });
  }

  const webhookUrl = process.env.GIB_EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.GIB_EMAIL_WEBHOOK_SECRET) {
        headers.Authorization = `Bearer ${process.env.GIB_EMAIL_WEBHOOK_SECRET}`;
      }
      const res = await transport(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: email,
          subject: 'Код входа в Город историй',
          text: `Ваш одноразовый код для входа: ${code}\nКод действует 10 минут. Никому не сообщайте его.`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: 'email_delivery_failed' };
      return { ok: true, delivered: 'webhook', expiresAt };
    } catch {
      return { ok: false, error: 'email_delivery_failed' };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return { ok: false, error: 'email_not_configured' };
  }

  return { ok: true, delivered: 'dev_preview', previewCode: code, expiresAt };
}

/** Проверяет одноразовый код входа по почте (не более 5 попыток) и возвращает `parentId`. */
export function verifyEmailOtp(rawEmail: string, rawCode: string, now = Date.now()): string | null {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\s|-/g, '');
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return null;

  const id = `eo_${email}`;
  const expectedHash = hashCode('email_otp', email, code);

  const bridge = pgBridgeIfEnabled();
  if (bridge) {
    const rows = bridge.query('SELECT code_hash, expires_at, attempts, used_at FROM gib.auth_challenges WHERE id = $1', [id]);
    if (!rows.length) return null;
    const row = rows[0];
    if (row.used_at !== null || Number(row.expires_at) <= now || Number(row.attempts) >= MAX_OTP_ATTEMPTS) {
      return null;
    }
    const matches = timingSafeEqual(Buffer.from(String(row.code_hash), 'hex'), Buffer.from(expectedHash, 'hex'));
    if (!matches) {
      bridge.query('UPDATE gib.auth_challenges SET attempts = attempts + 1 WHERE id = $1', [id]);
      return null;
    }
    bridge.query('UPDATE gib.auth_challenges SET used_at = $1 WHERE id = $2', [now, id]);
    return parentIdForEmail(email);
  }

  const row = memoryChallenges.get(id);
  if (!row || row.usedAt !== null || row.expiresAt <= now || row.attempts >= MAX_OTP_ATTEMPTS) return null;
  const matches = timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(expectedHash, 'hex'));
  if (!matches) {
    row.attempts += 1;
    return null;
  }
  row.usedAt = now;
  return parentIdForEmail(email);
}
