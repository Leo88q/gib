import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { billingConfig, cancelPlan, requestRefund, reconcileRefund, reconcilePayment } from '@/lib/billing';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Управление оплатой: отмена доступа и возврат денег.
 *
 * Почему отдельный маршрут, а не метод в `/api/subscribe`. `/api/subscribe`
 * открывает оплату; этот закрывает её. Разные права и разные проверки: отмена
 * доступа не требует провайдера, возврат требует и работает только после
 * подтверждения оплаты. Смешивать их в одном POST значило бы принимать
 * решение «отменить или вернуть» по одному полю из запроса.
 *
 * Возврат — только с явным подтверждением (`confirm: true`): это необратимое
 * действие с деньгами, и случайный двойной клик не должен его запускать.
 */
export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'subscription', auth.parentId), 20)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { profileId?: unknown; action?: unknown; confirm?: unknown; paymentId?: unknown };
  if (typeof body.profileId !== 'string' || !ownedProfile(auth.parentId, body.profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  const profileId = body.profileId;

  if (body.action === 'cancel') {
    const result = cancelPlan(profileId);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (body.action === 'refund') {
    if (body.confirm !== true) return NextResponse.json({ error: 'confirm_required' }, { status: 428 });
    const config = billingConfig();
    if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
    // Возвращаем последний подтверждённый платёж профиля: у взрослого их обычно
    // один-два, а выбирать платёж из списка в интерфейсе подписки незачем.
    const target = typeof body.paymentId === 'string'
      ? store.payments(profileId).find(payment => payment.id === body.paymentId)
      : [...store.payments(profileId)].filter(payment => payment.status === 'succeeded').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!target) return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
    try {
      const payment = await requestRefund(target.id, config);
      // Если провайдер ответил сразу `succeeded`, состояние уже применено;
      // если `pending` — уточняем один раз, чтобы кабинет не показывал
      // «возврат в процессе» после фактического возврата.
      if (payment.status === 'refund_pending' && payment.providerRefundId) {
        try { await reconcileRefund(payment.providerRefundId, config); } catch { /* статус уточнится позже */ }
      }
      const fresh = store.allPayments().find(item => item.id === target.id);
      return NextResponse.json({ ok: true, status: fresh?.status ?? payment.status }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'payment_not_paid') return NextResponse.json({ error: 'payment_not_paid' }, { status: 409 });
      if (message === 'refund_period_expired') return NextResponse.json({ error: 'refund_period_expired' }, { status: 409 });
      return NextResponse.json({ error: 'refund_unavailable' }, { status: 502 });
    }
  }

  if (body.action === 'reconcile') {
    const config = billingConfig();
    if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
    for (const payment of store.payments(profileId)) {
      if (!payment.providerId) continue;
      if (payment.status === 'refund_pending' && payment.providerRefundId) {
        try { await reconcileRefund(payment.providerRefundId, config); } catch { /* ниже вернём как есть */ }
      } else if (payment.status === 'pending') {
        try { await reconcilePayment(payment.providerId, config); } catch { /* ниже вернём как есть */ }
      }
    }
    const latest = [...store.payments(profileId)].sort((a, b) => b.createdAt - a.createdAt)[0];
    return NextResponse.json({ ok: true, status: latest?.status ?? null, subscription: store.sub(profileId) ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
