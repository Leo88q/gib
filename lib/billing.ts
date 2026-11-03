import { randomUUID } from 'node:crypto';
import { store } from './store.ts';
import type { Payment } from './types.ts';

const API = 'https://api.yookassa.ru/v3/payments';
type Config = { shopId: string; secret: string; returnUrl: string };
type ProviderPayment = { id?: string; status?: string; paid?: boolean; amount?: { value?: string; currency?: string }; metadata?: { intent_id?: string }; confirmation?: { confirmation_url?: string } };
type Transport = (input: string, init?: RequestInit) => Promise<Response>;

export function billingConfig(env: Record<string, string | undefined> = process.env): Config | null {
  const { YOOKASSA_SHOP_ID: shopId, YOOKASSA_SECRET_KEY: secret, YOOKASSA_RETURN_URL: returnUrl } = env;
  if (!shopId || !secret || !returnUrl) return null;
  try {
    const url = new URL(returnUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return { shopId, secret, returnUrl };
  } catch { return null; }
}
function providerHeaders(config: Config, idempotencyKey?: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secret}`).toString('base64')}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotence-Key': idempotencyKey } : {}) };
}
function safeConfirmationUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'yoomoney.ru' || url.hostname.endsWith('.yoomoney.ru') || url.hostname === 'yookassa.ru' || url.hostname.endsWith('.yookassa.ru'));
  } catch { return false; }
}
function matches(payment: Payment, remote: ProviderPayment): boolean {
  return !!remote.id && /^[a-zA-Z0-9_-]{1,100}$/.test(remote.id) && (!payment.providerId || payment.providerId === remote.id) && remote.metadata?.intent_id === payment.id && remote.amount?.value === payment.amount && remote.amount?.currency === payment.currency;
}
async function jsonResponse(response: Response): Promise<ProviderPayment> {
  if (!response.ok) throw new Error('provider_unavailable');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('provider_invalid_response');
  return value as ProviderPayment;
}

/** Повтор после сетевого сбоя использует тот же ключ идемпотентности. */
export async function createCheckout(profileId: string, config: Config, transport: Transport = fetch) {
  const payment = store.transaction(() => {
    const existing = store.payments(profileId).find(p => p.status === 'creating' || p.status === 'pending');
    if (existing) return existing;
    if (!store.profile(profileId)) throw new Error('profile_not_found');
    const next: Payment = { id: randomUUID(), profileId, plan: 'month', amount: '599.00', currency: 'RUB', days: 30, status: 'creating', createdAt: Date.now() };
    store.savePayment(next);
    return next;
  });
  if (payment.providerId && payment.confirmationUrl && payment.status === 'pending') return payment;
  // Не повторяем создание после истечения окна идемпотентности провайдера.
  if (payment.status === 'creating' && Date.now() - payment.createdAt > 20 * 60 * 60 * 1000) throw new Error('manual_reconciliation_required');
  const response = await transport(API, {
    method: 'POST', headers: providerHeaders(config, payment.id), signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ amount: { value: payment.amount, currency: payment.currency }, capture: true, confirmation: { type: 'redirect', return_url: config.returnUrl }, description: 'ГИБ: доступ на 30 дней', metadata: { intent_id: payment.id } }),
  });
  const remote = await jsonResponse(response);
  if (!matches(payment, remote) || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(remote.status ?? '')) throw new Error('provider_invalid_response');
  return store.transaction(() => {
    const current = store.payments(profileId).find(p => p.id === payment.id);
    if (!current || current.status === 'succeeded' || current.status === 'canceled') return current ?? payment;
    if (remote.status === 'canceled') {
      current.status = 'canceled'; current.providerId = remote.id;
    } else {
      if (remote.status === 'pending' && !safeConfirmationUrl(remote.confirmation?.confirmation_url)) throw new Error('provider_invalid_confirmation');
      current.providerId = remote.id;
      current.confirmationUrl = safeConfirmationUrl(remote.confirmation?.confirmation_url) ? remote.confirmation.confirmation_url : undefined;
      current.status = 'pending';
    }
    store.savePayment(current);
    return current;
  });
}

/** Событие или запрос клиента — лишь повод запросить статус в ЮKassa. */
export async function reconcilePayment(providerId: string, config: Config, transport: Transport = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(providerId)) throw new Error('invalid_payment');
  const local = store.paymentByProviderId(providerId);
  if (!local) throw new Error('payment_not_found');
  if (local.status === 'succeeded' || local.status === 'canceled') return local;
  const remote = await jsonResponse(await transport(`${API}/${encodeURIComponent(providerId)}`, { headers: providerHeaders(config), signal: AbortSignal.timeout(15000) }));
  if (!matches(local, remote)) throw new Error('payment_mismatch');
  if (remote.status === 'succeeded' && remote.paid === true) {
    return store.transaction(() => {
      const current = store.paymentByProviderId(providerId);
      if (!current || current.status !== 'pending' || current.appliedAt) return current ?? local;
      if (!store.profile(current.profileId)) throw new Error('profile_not_found');
      const now = Date.now();
      const sub = store.sub(current.profileId);
      const start = sub?.status === 'active' && sub.until > now ? sub.until : now;
      store.setSub({ profileId: current.profileId, plan: 'month', status: 'active', startedAt: sub?.status === 'active' && sub.until > now ? sub.startedAt : now, until: start + current.days * 86400000 });
      current.status = 'succeeded'; current.appliedAt = now;
      store.savePayment(current);
      return current;
    });
  }
  if (remote.status === 'canceled') {
    return store.transaction(() => {
      const current = store.paymentByProviderId(providerId);
      if (current && current.status === 'pending') { current.status = 'canceled'; store.savePayment(current); }
      return current ?? local;
    });
  }
  return local;
}
