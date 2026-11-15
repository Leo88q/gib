import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-billing-test-'));
process.env.GIB_DATA_FILE = path.join(dir, 'test.json');
if (process.env.GIB_STORE === 'sqlite') process.env.GIB_SQLITE_FILE = path.join(dir, 'test.sqlite');
const { store } = await import('../lib/store.ts');
process.env.GIB_RECEIPT_VAT_CODE = '1';
const { billingConfig, createCheckout, reconcilePayment, requestRefund, cancelPlan, pendingPayments } = await import('../lib/billing.ts');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); console.log('  ok', message); }
const config = billingConfig({ YOOKASSA_SHOP_ID: 'test', YOOKASSA_SECRET_KEY: 'test', YOOKASSA_RETURN_URL: 'https://example.com/parent' });
if (!config) throw new Error('config');
const profile = { id: 'test-profile', parentId: 'parent', name: 'Тест', age: 8, band: '8-10' as const, createdAt: Date.now() };
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const EMAIL = 'parent@example.ru';
let idempotence = '';
let remote: Record<string, unknown>;
let attempts = 0;
const transport = async (_input: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    const header = (init.headers as Record<string, string>)['Idempotence-Key'];
    if (idempotence) assert(idempotence === header, 'при повторе сохранён ключ идемпотентности');
    idempotence = header;
    attempts++;
    if (attempts === 1) throw new Error('network timeout');
    const body = JSON.parse(String(init.body));
    assert(body.amount.value === '599.00' && body.amount.currency === 'RUB', 'сумма формируется на сервере');
    // Чек — часть запроса на оплату: без него магазин не выставит чек, а приём
    // денег без чека незаконен. Почта берётся из платежа, ставка — из env.
    assert(body.receipt && body.receipt.customer && body.receipt.customer.email === EMAIL, 'чек уходит вместе с оплатой и на почту платежа');
    assert(body.receipt.items.length === 1 && body.receipt.items[0].vat_code === 1, 'в чеке одна позиция с настроенной ставкой НДС');
    assert(body.receipt.items[0].amount.value === body.amount.value, 'сумма чека совпадает с суммой платежа');
    remote = { id: 'payment-test-1', status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/test' } };
    return response(remote);
  }
  return response(remote);
};
try {
  store.addProfile(profile);
  assert(billingConfig({}) === null, 'без конфигурации платежи не включаются');
  assert(billingConfig({ YOOKASSA_SHOP_ID:'x', YOOKASSA_SECRET_KEY:'y', YOOKASSA_RETURN_URL:'http://example.com' }) === null, 'незащищённый return URL отклонён');
  await createCheckout(profile.id, config, transport, { receiptEmail: EMAIL }).then(() => { throw new Error('должна быть ошибка сети'); }, () => {});
  assert(!store.sub(profile.id), 'ошибка сети не активирует подписку');
  // Без почты оплата не начинается вовсе: чек обязан быть на момент расчёта.
  await createCheckout(profile.id, config, transport).then(() => { throw new Error('без почты оплата должна быть отклонена'); }, (error) => assert(String(error.message) === 'receipt_email_required', 'без почты оплата отклонена'));
  const payment = await createCheckout(profile.id, config, transport, { receiptEmail: EMAIL });
  assert(payment.status === 'pending' && !!payment.confirmationUrl, 'создано ожидающее подтверждение');
  assert(!store.sub(profile.id), 'создание платежа не активирует подписку');
  remote!.status = 'succeeded'; remote!.paid = true; remote!.amount = { value: '1.00', currency: 'RUB' };
  await reconcilePayment(payment.providerId!, config, transport).then(() => { throw new Error('неверная сумма должна быть отклонена'); }, () => {});
  assert(!store.sub(profile.id), 'несовпадающая сумма не активирует подписку');
  remote!.amount = { value: '599.00', currency: 'RUB' }; remote!.paid = false;
  await reconcilePayment(payment.providerId!, config, transport);
  assert(!store.sub(profile.id), 'неоплаченный платёж не активирует подписку');
  remote!.paid = true;
  await Promise.all([reconcilePayment(payment.providerId!, config, transport), reconcilePayment(payment.providerId!, config, transport)]);
  const until = store.sub(profile.id)?.until;
  assert(!!until && store.sub(profile.id)?.status === 'active' && Math.abs(until - (Date.now() + 30 * 86400000)) < 5000, 'два параллельных подтверждения дают ровно 30 дней');
  await reconcilePayment(payment.providerId!, config, transport);
  assert(store.sub(profile.id)?.until === until, 'повтор события не продлевает доступ дважды');
  const other = { ...profile, id: 'concurrent-profile', parentId: 'other-parent' };
  store.addProfile(other);
  const keys: string[] = [];
  const simultaneousTransport = async (_url: string, init?: RequestInit) => {
    keys.push((init!.headers as Record<string, string>)['Idempotence-Key']);
    const body = JSON.parse(String(init!.body));
    await new Promise(resolve => setTimeout(resolve, 10));
    return response({ id: 'payment-test-2', status: 'pending', amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/test' } });
  };
  const concurrent = await Promise.all([
    createCheckout(other.id, config, simultaneousTransport, { receiptEmail: EMAIL }),
    createCheckout(other.id, config, simultaneousTransport, { receiptEmail: EMAIL }),
  ]);
  assert(keys.length === 2 && keys[0] === keys[1] && concurrent[0].id === concurrent[1].id && store.payments(other.id).length === 1, 'параллельное создание использует один ключ и одну запись');

  /* ---- Возврат: деньги назад и доступ закрывается ---- */

  let refundRequests = 0;
  const refundTransport = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/refunds') && init?.method === 'POST') {
      refundRequests++;
      const body = JSON.parse(String(init.body));
      assert(body.payment_id === payment.providerId, 'возврат относится к тому же платежу у провайдера');
      assert(body.amount.value === '599.00' && body.amount.currency === 'RUB', 'возвращается полная сумма платежа');
      const key = (init.headers as Record<string, string>)['Idempotence-Key'];
      assert(key === `refund-${payment.id}`, 'ключ идемпотентности возврата привязан к платежу');
      return response({ id: 'refund-test-1', status: 'pending', payment_id: payment.providerId, amount: body.amount });
    }
    return response({ id: 'refund-test-1', status: 'succeeded', payment_id: payment.providerId, amount: { value: '599.00', currency: 'RUB' } });
  };
  const refunding = await requestRefund(payment.id, config, refundTransport);
  assert(refunding.status === 'refund_pending', 'неподтверждённый возврат не закрывает доступ');
  assert(store.sub(profile.id)?.status === 'active', 'пока возврат в процессе, доступ остаётся');
  // Повторный запрос не создаёт второй возврат: деньги нельзя вернуть дважды.
  const again = await requestRefund(payment.id, config, refundTransport);
  assert(refundRequests === 1 && again.status === 'refund_pending', 'повторный возврат не уходит провайдеру второй раз');
  const { reconcileRefund } = await import('../lib/billing.ts');
  const refunded = await reconcileRefund('refund-test-1', config, refundTransport);
  assert(refunded.status === 'refunded' && refunded.refundedAt !== undefined, 'подтверждённый провайдером возврат фиксируется');
  assert(store.sub(profile.id)?.status !== 'active', 'подтверждённый возврат закрывает доступ');
  const third = await requestRefund(payment.id, config, refundTransport);
  assert(third.status === 'refunded' && refundRequests === 1, 'возвращённый платёж не возвращается повторно');

  /* ---- Отмена: доступ закрывается, деньги остаются ---- */

  const second = { ...profile, id: 'cancel-profile', parentId: 'cancel-parent' };
  store.addProfile(second);
  store.setSub({ profileId: second.id, plan: 'month', status: 'active', startedAt: Date.now(), until: Date.now() + 20 * 86400000 });
  const canceled = cancelPlan(second.id);
  assert(canceled.canceled && store.sub(second.id)?.status === 'expired', 'отмена закрывает доступ сразу');
  assert(cancelPlan(second.id).canceled === false, 'повторная отмена ничего не меняет');

  /* ---- Какие платежи требуют сверки ---- */

  assert(pendingPayments(other.id).length === 1, 'незавершённый платёж виден как ожидающий сверки');
  assert(pendingPayments(profile.id).length === 0, 'возвращённый платёж не считается ожидающим');

} finally { fs.rmSync(dir, { recursive: true, force: true }); }
