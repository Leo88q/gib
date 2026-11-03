import { NextResponse } from 'next/server';
import { verifyInitData } from './telegram';
import { verifyMaxInitData } from './max-auth';
import { store } from './store';

/** Header-only, platform-scoped authentication. No fallback after invalid signed data. */
export function requestParent(req: Request): string | null {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const maxToken = process.env.MAX_BOT_TOKEN;
  // The wire formats are identical: a shared token would allow cross-platform replay.
  if (telegramToken && maxToken && telegramToken === maxToken) return null;
  const hasTelegram = req.headers.has('x-telegram-init-data');
  const hasMax = req.headers.has('x-max-init-data');
  if (hasTelegram && hasMax) return null;
  if (hasTelegram) {
    const verified = verifyInitData(req.headers.get('x-telegram-init-data') ?? '', telegramToken);
    // Preserve existing Telegram IDs for existing profiles.
    return verified.ok && verified.user ? String(verified.user.id) : null;
  }
  if (hasMax) {
    const verified = verifyMaxInitData(req.headers.get('x-max-init-data') ?? '', maxToken);
    return verified.ok ? verified.subject : null;
  }
  if (telegramToken || maxToken || process.env.NODE_ENV !== 'development' || process.env.GIB_DEMO_MODE !== '1') return null;
  const demo = req.headers.get('x-demo-parent') ?? 'local-demo';
  return /^[a-zA-Z0-9_-]{1,80}$/.test(demo) ? `demo:${demo}` : null;
}

export function requireParent(req: Request): { parentId: string; error?: never } | { parentId?: never; error: NextResponse } {
  const parentId = requestParent(req);
  return parentId ? { parentId } : { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
}

/** Возвращаем одинаковый 404 для чужого и несуществующего профиля. */
export function ownedProfile(parentId: string, profileId: string) {
  const profile = store.profile(profileId);
  return profile?.parentId === parentId ? profile : undefined;
}
