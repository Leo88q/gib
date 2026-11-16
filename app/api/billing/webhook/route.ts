import { readJsonObject } from '@/lib/http-body';
import { NextResponse } from 'next/server';
import { billingConfig, reconcilePayment, reconcileRefund } from '@/lib/billing';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { recordFunnel } from '@/lib/events/funnel-store';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';
const EVENTS = ['payment.succeeded', 'payment.canceled', 'refund.succeeded'];

/**
 * Вебхук провайдера.
 *
 * Ключевое правило не изменилось: содержимое вебхука не является
 * доказательством оплаты. Из него берётся только идентификатор, а состояние
 * уточняется запросом к API. Это защищает от подделки запроса и от повторной
 * доставки: второй `payment.succeeded` по тому же платежу не даёт вторые
 * 30 дней, потому что применение идемпотентно.
 *
 * Что добавилось: возвраты. `refund.succeeded` сообщает id возврата, а не
 * платежа, поэтому платёж находится по `providerRefundId` — тому, который
 * сохранён при запросе возврата.
 */
export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, 'billing-webhook'), 240)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const config = billingConfig();
  if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { event?: unknown; object?: { id?: unknown } };
  if (!body || !EVENTS.includes(String(body.event)) || typeof body.object?.id !== 'string') return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  try {
    if (body.event === 'refund.succeeded') {
      await reconcileRefund(body.object.id, config);
      return NextResponse.json({ ok: true });
    }
    const payment = await reconcilePayment(body.object.id, config);
    // Оплата, подтверждённая провайдером, — единственный источник шага «оплачено».
    if (body.event === 'payment.succeeded' && payment.status === 'succeeded') {
      const profile = store.profile(payment.profileId);
      if (profile) recordFunnel({ step: 'paid', ownerId: profile.parentId, at: payment.appliedAt ?? Date.now() });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'payment_not_found' || message === 'refund_not_found') return NextResponse.json({ error: message }, { status: 404 });
    if (message === 'invalid_payment' || message === 'invalid_refund' || message === 'payment_mismatch') return NextResponse.json({ error: 'invalid_payment' }, { status: 400 });
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }
}
