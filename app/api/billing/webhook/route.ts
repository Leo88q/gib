import { readJsonObject } from '@/lib/http-body';
import { NextResponse } from 'next/server';
import { billingConfig, reconcilePayment } from '@/lib/billing';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
/** Содержимое webhook не является доказательством оплаты: сверяем его с API провайдера. */
export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, 'billing-webhook'), 240)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const config = billingConfig();
  if (!config) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { event?: unknown; object?: { id?: unknown } };
  if (!body || !['payment.succeeded', 'payment.canceled'].includes(String(body.event)) || typeof body.object?.id !== 'string') return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  try {
    await reconcilePayment(body.object.id, config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'payment_not_found') return NextResponse.json({ error: 'payment_not_found' }, { status: 404 });
    if (message === 'invalid_payment' || message === 'payment_mismatch') return NextResponse.json({ error: 'invalid_payment' }, { status: 400 });
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }
}
