import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-billing-test-'));
process.env.GIB_DATA_FILE = path.join(dir, 'test.json');
if (process.env.GIB_STORE === 'sqlite') process.env.GIB_SQLITE_FILE = path.join(dir, 'test.sqlite');
const { store } = await import('../lib/store.ts');
const { billingConfig, createCheckout, reconcilePayment } = await import('../lib/billing.ts');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); console.log('  ok', message); }
const config = billingConfig({ YOOKASSA_SHOP_ID: 'test', YOOKASSA_SECRET_KEY: 'test', YOOKASSA_RETURN_URL: 'https://example.com/parent' });
if (!config) throw new Error('config');
const profile = { id: 'test-profile', parentId: 'parent', name: 'Тест', age: 8, band: '8-10' as const, createdAt: Date.now() };
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    remote = { id: 'payment-test-1', status: 'pending', paid: false, amount: body.amount, metadata: body.metadata, confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/test' } };
    return response(remote);
  }
  return response(remote);
};
try {
  store.addProfile(profile);
  assert(billingConfig({}) === null, 'без конфигурации платежи не включаются');
  assert(billingConfig({ YOOKASSA_SHOP_ID:'x', YOOKASSA_SECRET_KEY:'y', YOOKASSA_RETURN_URL:'http://example.com' }) === null, 'незащищённый return URL отклонён');
  await createCheckout(profile.id, config, transport).then(() => { throw new Error('должна быть ошибка сети'); }, () => {});
  assert(!store.sub(profile.id), 'ошибка сети не активирует подписку');
  const payment = await createCheckout(profile.id, config, transport);
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
  const concurrent = await Promise.all([createCheckout(other.id, config, simultaneousTransport), createCheckout(other.id, config, simultaneousTransport)]);
  assert(keys.length === 2 && keys[0] === keys[1] && concurrent[0].id === concurrent[1].id && store.payments(other.id).length === 1, 'параллельное создание использует один ключ и одну запись');

} finally { fs.rmSync(dir, { recursive: true, force: true }); }
