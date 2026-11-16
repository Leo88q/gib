import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { canSend, DEFAULT_NOTIFICATIONS, waitText } from '@/lib/family/notifications';
import { deliverToParent, formatWeeklyReport } from '@/lib/bots/messenger';

export const dynamic = 'force-dynamic';

/**
 * Ручная отправка недельного отчёта взрослому в его активный канал
 * (Telegram, MAX или электронную почту) с соблюдением серверного лимита частоты.
 */
export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'notify-send', auth.parentId), 10, 60_000)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { profileId?: unknown };
  if (typeof body.profileId !== 'string' || !body.profileId) {
    return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  }
  const profile = ownedProfile(auth.parentId, body.profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  const settings = store.notificationSettings(auth.parentId) ?? DEFAULT_NOTIFICATIONS;
  const now = Date.now();
  const decision = canSend(settings, settings.enabled, now);
  if (!decision.allowed) {
    const message =
      decision.reason === 'consent_required' || decision.reason === 'disabled'
        ? 'Отчёты отключены. Включите уведомления выше — это отдельное согласие.'
        : `Отчёт уже отправляли недавно. Следующий можно через ${waitText(decision.retryAfterMs ?? 0)}.`;
    return NextResponse.json({ sent: false, error: decision.reason, message }, { status: 409 });
  }

  const text = formatWeeklyReport(profile);
  const delivery = await deliverToParent(auth.parentId, text, {
    subject: `Город историй — отчёт за неделю (${profile.name})`,
  });
  if (delivery.sent) {
    store.setNotificationSettings(auth.parentId, { ...settings, lastSentAt: now });
  }
  return NextResponse.json({
    sent: delivery.sent,
    channel: delivery.channel,
    detail: delivery.detail,
    preview: text,
  });
}
