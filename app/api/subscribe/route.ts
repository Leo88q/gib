import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { billingConfig, createCheckout, reconcilePayment } from '@/lib/billing';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
const plans = { month: { title: '30 дней доступа', price: 599, perks: ['Тренировки и отчёт', 'Без автоматического продления'] } };

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'subscribe', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (!ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  const config = billingConfig();
  const pending = store.payments(profileId).find(p => p.status === 'pending' && p.providerId);
  if (pending?.providerId && config) {
    try { await reconcilePayment(pending.providerId, config); } catch { /* оставляем прежний статус, доступ без подтверждения не выдаём */ }
  }
  // Старые демо-подписки не считаются оплаченными.
  const sub = store.payments(profileId).some(p => p.status === 'succeeded' && p.appliedAt) ? store.sub(profileId) : undefined;
  const subscription = sub && sub.until <= Date.now() ? { ...sub, status: 'expired' } : sub;
  return NextResponse.json({ subscription: subscription ?? null, plans, available: Boolean(config) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'subscribe-post', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { profileId?: string; plan?: string };
  if (!body.profileId || !ownedProfile(auth.parentId, body.profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  if (body.plan !== 'month') return NextResponse.json({ error: 'unknown_plan' }, { status: 400 });
  const config = billingConfig();
  if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
  try {
    const payment = await createCheckout(body.profileId, config);
    if (!payment.confirmationUrl) return NextResponse.json({ error: 'payment_pending_verification' }, { status: 409 });
    return NextResponse.json({ checkoutUrl: payment.confirmationUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'payment_unavailable' }, { status: 502 });
  }
}
