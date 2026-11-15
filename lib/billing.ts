import { randomUUID } from 'node:crypto';
import { store } from './store.ts';
import type { Payment } from './types.ts';
import { buildReceipt, receiptConfig, validEmail, type ReceiptConfig } from './billing/receipt.ts';
import { OFFER_VERSION } from './legal/documents.ts';

/**
 * ЮKassa: оплата, отмена, возврат и сверка.
 *
 * Что было и что стало. Раньше здесь жил только `createCheckout`: денег на
 * счёте магазина он не касался, чека не формировал, отменить подписку было
 * нельзя, возврат — тоже. Теперь контур замкнут, и у каждого действия есть
 * правило: **состояние меняет только ответ провайдера, подтверждённый
 * повторным запросом**. Ни вебхук, ни нажатие кнопки в интерфейсе сами по
 * себе доступ не продлевают и не отнимают.
 *
 * Порядок чтения:
 *   createCheckout   — новый платёж и ссылка на оплату (с чеком);
 *   reconcilePayment — сверка одного платежа;
 *   requestRefund    — возврат с защитой от второго;
 *   cancelPlan       — отмена доступа без возврата (по желанию взрослого).
 *
 * Чего здесь по-прежнему нет: автоматического списания. Тариф — разовая
 * оплата 30 дней, продление — добровольное. Это решение продукта, а не
 * недоделка: ребёнку не нужна подписка, которая списывает деньги, пока
 * родитель не смотрит.
 */

const API = 'https://api.yookassa.ru/v3/payments';
type Config = { shopId: string; secret: string; returnUrl: string };
type ProviderPayment = {
  id?: string;
  status?: string;
  paid?: boolean;
  amount?: { value?: string; currency?: string };
  metadata?: { intent_id?: string };
  confirmation?: { confirmation_url?: string };
  cancellation_details?: { reason?: string };
  refunded_amount?: { value?: string; currency?: string };
};
type ProviderRefund = { id?: string; status?: string; payment_id?: string; amount?: { value?: string; currency?: string } };
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

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('provider_unavailable');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('provider_invalid_response');
  return value as T;
}

/**
 * Чек для платежа.
 *
 * Конфигурация чека обязательна: без неё оплата не начинается. Это жёсткое
 * решение — лучше не продать, чем взять деньги без чека.
 */
function receiptFor(payment: Payment): { config: ReceiptConfig; email: string } {
  const config = receiptConfig();
  if (!config) throw new Error('receipt_not_configured');
  if (!payment.receiptEmail || !validEmail(payment.receiptEmail)) throw new Error('receipt_email_required');
  return { config, email: payment.receiptEmail };
}

/**
 * Открыть оплату.
 *
 * Повторный запрос возвращает тот же платёж: ключ идемпотентности — id
 * платежа. Если предыдущий ещё `creating`, новый не создаётся, иначе взрослый
 * увидит два окна с разными суммами и оплатит дважды.
 */
export async function createCheckout(profileId: string, config: Config, transport: Transport = fetch, options: { receiptEmail?: string } = {}) {
  const email = (options.receiptEmail ?? '').trim().toLowerCase();
  if (!validEmail(email)) throw new Error('receipt_email_required');
  const payment = store.transaction(() => {
    const existing = store.payments(profileId).find(p => p.status === 'creating' || p.status === 'pending');
    if (existing) return existing;
    if (!store.profile(profileId)) throw new Error('profile_not_found');
    const next: Payment = { id: randomUUID(), profileId, plan: 'month', amount: '599.00', currency: 'RUB', days: 30, status: 'creating', createdAt: Date.now(), receiptEmail: email, offerVersion: OFFER_VERSION };
    store.savePayment(next);
    return next;
  });
  // Повтор после истечения окна идемпотентности провайдера: сверять вручную.
  if (payment.status === 'creating' && Date.now() - payment.createdAt > 20 * 60 * 60 * 1000) throw new Error('manual_reconciliation_required');
  if (payment.providerId && payment.confirmationUrl && payment.status === 'pending') return payment;
  // Чек собирается до сетевого запроса: без него оплату начинать нельзя.
  const receipt = receiptFor(payment);
  const response = await transport(API, {
    method: 'POST', headers: providerHeaders(config, payment.id), signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      amount: { value: payment.amount, currency: payment.currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: config.returnUrl },
      description: 'ГИБ: доступ на 30 дней',
      receipt: buildReceipt({ amount: payment.amount, currency: payment.currency, description: 'Доступ к «ГИБ»: 30 дней', config: receipt.config, customerEmail: receipt.email }),
      metadata: { intent_id: payment.id },
    }),
  });
  const remote = await jsonResponse<ProviderPayment>(response);
  if (!matches(payment, remote) || !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(remote.status ?? '')) throw new Error('provider_invalid_response');
  return store.transaction(() => {
    const current = store.payments(profileId).find(p => p.id === payment.id);
    if (!current || current.status === 'succeeded' || current.status === 'canceled') return current ?? payment;
    if (remote.status === 'canceled') {
      current.status = 'canceled'; current.providerId = remote.id; current.canceledAt = Date.now();
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

/**
 * Применить успешный платёж.
 *
 * Условие ровно одно и то же для всех путей: `status === pending`, `paid`,
 * сумма совпадает, `appliedAt` ещё не стоит. Отсюда следует, что два
 * одновременных подтверждения дают 30 дней, а не 60.
 */
function applyPaid(profileId: string, providerId: string, now: number): Payment | undefined {
  const current = store.paymentByProviderId(providerId);
  if (!current || current.profileId !== profileId) return current;
  if (current.status !== 'pending' || current.appliedAt) return current;
  if (!store.profile(current.profileId)) throw new Error('profile_not_found');
  const sub = store.sub(current.profileId);
  const active = sub?.status === 'active' && sub.until > now;
  const start = active ? sub!.until : now;
  store.setSub({ profileId: current.profileId, plan: 'month', status: 'active', startedAt: active ? sub!.startedAt : now, until: start + current.days * 86400000 });
  current.status = 'succeeded';
  current.appliedAt = now;
  current.confirmationUrl = undefined;
  store.savePayment(current);
  return current;
}

/** Сверка одного платежа. Вебхук и проверка по возвращении с оплаты идут сюда. */
export async function reconcilePayment(providerId: string, config: Config, transport: Transport = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(providerId)) throw new Error('invalid_payment');
  const local = store.paymentByProviderId(providerId);
  if (!local) throw new Error('payment_not_found');
  if (local.status === 'succeeded' || local.status === 'canceled' || local.status === 'refunded') return local;
  const remote = await jsonResponse<ProviderPayment>(await transport(`${API}/${encodeURIComponent(providerId)}`, { headers: providerHeaders(config), signal: AbortSignal.timeout(15000) }));
  if (!matches(local, remote)) throw new Error('payment_mismatch');
  if (remote.status === 'succeeded' && remote.paid === true) {
    return store.transaction(() => applyPaid(local.profileId, providerId, Date.now()) ?? local);
  }
  if (remote.status === 'canceled') {
    return store.transaction(() => {
      const current = store.paymentByProviderId(providerId);
      if (current && current.status === 'pending') { current.status = 'canceled'; current.canceledAt = Date.now(); store.savePayment(current); }
      return current ?? local;
    });
  }
  return local;
}

/**
 * Завершение возврата.
 *
 * Вызывается сверкой и вебхуком `refund.succeeded`. Возврат подтверждён
 * только когда провайдер так и сказал; запрос клиента — лишь повод проверить.
 */
function applyRefunded(providerId: string, refundId: string, now: number): Payment | undefined {
  const current = store.paymentByProviderId(providerId);
  if (!current || current.status !== 'refund_pending') return current;
  current.status = 'refunded';
  current.refundedAt = now;
  current.providerRefundId = refundId;
  store.savePayment(current);
  // Доступ снимается вместе с деньгами: возврат означает, что услуга не оказана.
  // Если взрослый заплатил снова, новая подписка перезапишет запись; поэтому
  // отзываем только ту, что началась не позже этого платежа.
  const sub = store.sub(current.profileId);
  if (sub && sub.status === 'active' && sub.startedAt <= (current.appliedAt ?? now)) {
    store.setSub({ ...sub, status: 'expired', until: Math.min(sub.until, now) });
  }
  return current;
}

/**
 * Запросить возврат.
 *
 * Защита от второго возврата: пока платёж `refund_pending`, второй запрос
 * возвращает существующий. Ключ идемпотентности `refund-<paymentId>` — тот же
 * приём, что при оплате.
 */
export async function requestRefund(paymentId: string, config: Config, transport: Transport = fetch, options: { reason?: string } = {}) {
  const local = store.allPayments().find(payment => payment.id === paymentId);
  if (!local) throw new Error('payment_not_found');
  if (!local.providerId) throw new Error('payment_not_paid');
  if (local.status === 'refunded') return local;
  if (local.status === 'refund_pending') return local;
  if (local.status !== 'succeeded' || !local.appliedAt) throw new Error('payment_not_paid');
  const amount = { value: local.amount, currency: local.currency };
  const remote = await jsonResponse<ProviderRefund>(await transport('https://api.yookassa.ru/v3/refunds', {
    method: 'POST', headers: providerHeaders(config, `refund-${local.id}`), signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ payment_id: local.providerId, amount, description: options.reason?.slice(0, 128) || 'Возврат по заявлению родителя' }),
  }));
  if (!remote.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(remote.id)) throw new Error('provider_invalid_response');
  if (!['pending', 'succeeded'].includes(remote.status ?? '')) throw new Error('provider_invalid_response');
  if (remote.payment_id && remote.payment_id !== local.providerId) throw new Error('payment_mismatch');
  if (remote.amount && (remote.amount.value !== local.amount || remote.amount.currency !== local.currency)) throw new Error('payment_mismatch');
  return store.transaction(() => {
    const current = store.paymentByProviderId(local.providerId!);
    if (!current) throw new Error('payment_not_found');
    if (current.status === 'refunded') return current;
    if (remote.status === 'succeeded') return applyRefunded(current.providerId!, remote.id!, Date.now()) ?? current;
    current.status = 'refund_pending';
    current.providerRefundId = remote.id;
    store.savePayment(current);
    return current;
  });
}

/**
 * Сверка возврата, о котором пришёл вебхук.
 *
 * Провайдер сообщает id возврата, а не платежа: находим платёж по
 * `providerRefundId` и уточняем статус возврата запросом.
 */
export async function reconcileRefund(refundId: string, config: Config, transport: Transport = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(refundId)) throw new Error('invalid_refund');
  const local = store.allPayments().find(payment => payment.providerRefundId === refundId);
  if (!local) throw new Error('refund_not_found');
  if (local.status === 'refunded') return local;
  const remote = await jsonResponse<ProviderRefund>(await transport(`https://api.yookassa.ru/v3/refunds/${encodeURIComponent(refundId)}`, { headers: providerHeaders(config), signal: AbortSignal.timeout(15000) }));
  if (remote.id !== refundId) throw new Error('payment_mismatch');
  if (remote.status === 'succeeded') {
    return store.transaction(() => applyRefunded(local.providerId!, refundId, Date.now()) ?? local);
  }
  return local;
}

/**
 * Отмена доступа взрослым.
 *
 * Возврат денег — отдельное действие (`requestRefund`) и отдельное право:
 * отмена «до конца оплаченного срока» не возвращает деньги. Здесь доступ
 * закрывается сразу, потому что так решил взрослый; если он передумает,
 * новая оплата откроет его снова.
 */
export function cancelPlan(profileId: string, now = Date.now()): { canceled: boolean; until?: number } {
  return store.transaction(() => {
    const sub = store.sub(profileId);
    if (!sub || sub.status !== 'active') return { canceled: false };
    store.setSub({ ...sub, status: 'expired', until: Math.min(sub.until, now) });
    return { canceled: true, until: now };
  });
}

/**
 * Платежи, которые висят и требуют сверки.
 *
 * Нужны для страницы «Моя подписка» и для ручной сверки: неоплаченная ссылка
 * живёт недолго, но если взрослый оплатил и закрыл окно — сверка найдёт это
 * при следующем открытии кабинета.
 */
export function pendingPayments(profileId: string): Payment[] {
  return store.payments(profileId).filter(payment => payment.status === 'pending' || payment.status === 'refund_pending');
}
