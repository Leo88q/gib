import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { readJsonObject } from '@/lib/http-body';
import { store } from '@/lib/store';
import {
  canSend,
  DEFAULT_NOTIFICATIONS,
  FREQUENCY_LABELS,
  FREQUENCY_MS,
  validFrequency,
  waitText,
  type NotificationSettings,
} from '@/lib/family/notifications';

export const dynamic = 'force-dynamic';

/**
 * Уведомления взрослому: согласие, частота, ближайшая возможная отправка.
 *
 * Согласие на сохранение отметок чувств (отдельный блок кабинета) не считается
 * согласием на сообщения: это разные решения. Без отдельного согласия отчёт
 * не отправится даже по кнопке.
 */
function view(settings: NotificationSettings, consent: boolean) {
  const now = Date.now();
  const decision = canSend(settings, consent, now);
  const frequency = settings.frequency;
  return NextResponse.json({
    settings: { enabled: settings.enabled, frequency, lastSentAt: settings.lastSentAt },
    labels: FREQUENCY_LABELS,
    intervals: FREQUENCY_MS,
    canSendNow: decision.allowed,
    reason: decision.allowed ? null : decision.reason,
    retryAfterMs: decision.allowed ? 0 : decision.retryAfterMs ?? 0,
    retryText: decision.allowed || !decision.retryAfterMs ? '' : waitText(decision.retryAfterMs),
    notice: settings.enabled
      ? `Отчёт взрослому: ${FREQUENCY_LABELS[frequency].toLowerCase()}. Ребёнку сообщения не отправляются.`
      : 'Уведомлений нет. Включить можно в любой момент — это отдельное согласие.',
  });
}

export async function GET(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'notifications', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (profileId && !ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  const settings = store.notificationSettings(auth.parentId) ?? DEFAULT_NOTIFICATIONS;
  // Для GET согласие взрослого и есть сохранённая настройка: пока её нет, уведомлений нет.
  return view(settings, true);
}

export async function POST(req: Request) {
  const auth = requireParent(req); if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'notifications-write', auth.parentId), 40)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req); if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (Object.keys(body).some(k => !['profileId', 'enabled', 'frequency'].includes(k))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (typeof body.profileId !== 'string' || !body.profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (typeof body.enabled !== 'boolean' || !validFrequency(body.frequency)) return NextResponse.json({ error: 'invalid_settings' }, { status: 400 });
  // Включённые уведомления обязаны иметь частоту; выключенные — только 'off'.
  if (body.enabled ? body.frequency === 'off' : body.frequency !== 'off') {
    return NextResponse.json({ error: 'invalid_settings', hint: body.enabled ? 'frequency_required' : 'frequency_must_be_off' }, { status: 400 });
  }

  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, body.profileId as string);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const previous = store.notificationSettings(auth.parentId) ?? DEFAULT_NOTIFICATIONS;
    const next: NotificationSettings = {
      enabled: body.enabled as boolean,
      frequency: body.frequency as NotificationSettings['frequency'],
      // Время последней отправки сохраняем: иначе частота обходится выключателем.
      lastSentAt: previous.lastSentAt,
    };
    store.setNotificationSettings(auth.parentId, next);
    return view(next, next.enabled);
  });
}
