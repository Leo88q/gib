import crypto from 'node:crypto';

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

/** Подпись, уникальные параметры и ограничение возраста initData по документации Telegram. */
export function verifyInitData(initData: string, botToken: string | undefined, now = Date.now()): { ok: boolean; user: TelegramUser | null } {
  if (!botToken || !initData || initData.length > 8192) return { ok: false, user: null };
  try {
    const params = new URLSearchParams(initData);
    const keys = [...params.keys()];
    if (new Set(keys).size !== keys.length) return { ok: false, user: null };
    const hash = params.get('hash');
    const authDate = Number(params.get('auth_date'));
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isInteger(authDate) || authDate > now / 1000 + 30 || now / 1000 - authDate > 86400) return { ok: false, user: null };
    params.delete('hash');
    const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
    const received = Buffer.from(hash, 'hex');
    if (received.length !== expected.length || !crypto.timingSafeEqual(expected, received)) return { ok: false, user: null };
    const user = JSON.parse(params.get('user') ?? 'null') as TelegramUser | null;
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, user: null };
    return { ok: true, user };
  } catch { return { ok: false, user: null }; }
}
