import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { billingConfig, createCheckout, reconcilePayment, pendingPayments } from '@/lib/billing';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { planById, PLANS } from '@/lib/content/plans';
import { FREE_LESSONS, SUBSCRIPTION_DAYS, activeSubscription } from '@/lib/access/entitlement';
import { receiptConfig, receiptReady } from '@/lib/billing/receipt';
import { YEAR, lessonOfDay } from '@/lib/content/year';
import { programPosition } from '@/lib/engine/session';
import { recordFunnel } from '@/lib/events/funnel-store';
import { OFFER_VERSION } from '@/lib/legal/documents';

export const dynamic = 'force-dynamic';

const plan = planById('month');

/**
 * Состояние подписки для кабинета.
 *
 * Что здесь важно и почему. Ответ отдаёт не только «есть/нет», но и то, что
 * продукт раньше не сообщал: сколько встреч открыто без оплаты, какая встреча
 * следующая, действует ли оплата, чем кончился прошлый платёж. Без этого
 * взрослый видел кнопку «оплатить» без объяснения, за что.
 *
 * Сверка платежей идёт здесь же: взрослый возвращается с оплаты и видит
 * результат без ожидания вебхука. Сверка — это запрос к провайдеру, а не
 * доверие к браузеру.
 */
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'subscribe', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  const config = billingConfig();
  const receipt = receiptConfig();
  // Сверяем всё, что висит: и оплату, и возврат. Ошибка сверки не ломает
  // ответ — иначе кабинет перестанет открываться из-за недоступного провайдера.
  if (config) for (const payment of pendingPayments(profileId)) {
    if (!payment.providerId) continue;
    try { await reconcilePayment(payment.providerId, config); } catch { /* статус останется прежним */ }
  }
  const paid = store.payments(profileId).some(payment => payment.status === 'succeeded' && payment.appliedAt);
  const sub = paid ? store.sub(profileId) : undefined;
  const subscription = sub && sub.until <= Date.now() ? { ...sub, status: 'expired' as const } : sub ?? null;
  const active = activeSubscription(sub);
  const lesson = lessonOfDay(YEAR, programPosition(profileId).dayIndex);
  const last = [...store.payments(profileId)].sort((a, b) => b.createdAt - a.createdAt)[0];
  return NextResponse.json({
    subscription,
    plans: PLANS,
    plan,
    available: Boolean(config) && receiptReady(receipt),
    /** Почему оплата недоступна: без чека принимать деньги нельзя. */
    unavailableReason: !config ? 'provider_not_configured' : !receiptReady(receipt) ? 'receipt_not_configured' : null,
    access: {
      freeLessons: FREE_LESSONS,
      active,
      lessonsTotal: YEAR.lessons.length,
      currentLesson: lesson?.number ?? 1,
      days: SUBSCRIPTION_DAYS,
    },
    lastPayment: last ? { status: last.status, amount: last.amount, createdAt: last.createdAt, appliedAt: last.appliedAt ?? null, refundedAt: last.refundedAt ?? null } : null,
    offerVersion: OFFER_VERSION,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Начать оплату.
 *
 * Требования к запросу: профиль ребёнка (проверяется владелец) и почта для
 * чека. Без почты оплата не начинается: чек обязан быть на момент расчёта, а
 * придумывать адрес за взрослого нельзя.
 */
export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'subscribe-post', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { profileId?: string; plan?: string; receiptEmail?: string; offerAccepted?: boolean };
  if (!body.profileId || !ownedProfile(auth.parentId, body.profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  if (body.plan !== 'month') return NextResponse.json({ error: 'unknown_plan' }, { status: 400 });
  if (body.offerAccepted !== true) return NextResponse.json({ error: 'offer_required', version: OFFER_VERSION }, { status: 428 });
  if (typeof body.receiptEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(body.receiptEmail.trim())) {
    return NextResponse.json({ error: 'receipt_email_required' }, { status: 400 });
  }
  const config = billingConfig();
  if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
  if (!receiptReady(receiptConfig())) return NextResponse.json({ error: 'receipt_not_configured' }, { status: 503 });
  try {
    const payment = await createCheckout(body.profileId, config, fetch, { receiptEmail: body.receiptEmail });
    if (!payment.confirmationUrl) return NextResponse.json({ error: 'payment_pending_verification' }, { status: 409 });
    recordFunnel({ step: 'paywall_seen', ownerId: auth.parentId, lessonNumber: lessonOfDay(YEAR, programPosition(body.profileId).dayIndex)?.number ?? 1, at: Date.now() });
    return NextResponse.json({ checkoutUrl: payment.confirmationUrl, paymentId: payment.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'receipt_not_configured' || message === 'receipt_email_required') return NextResponse.json({ error: message }, { status: 503 });
    return NextResponse.json({ error: 'payment_unavailable' }, { status: 502 });
  }
}
