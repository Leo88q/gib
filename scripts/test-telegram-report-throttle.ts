/**
 * Отправка отчёта: недоставка и ограничение частоты.
 *
 * Модуль маршрута загружается с подменённым `fetch` к api.telegram.org:
 * так проверяются и мягкая деградация при сбое сети, и то, что повтор
 * раньше срока отклоняется сервером, а не только текстом интерфейса.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GIB_STORE = 'json';
process.env.GIB_DATA_FILE = join(mkdtempSync(join(tmpdir(), 'gib-report-')), 'db.json');
process.env.TELEGRAM_BOT_TOKEN = 'stub-token';

type Call = { url: string; body: any };
let mode: 'ok' | 'offline' | 'rejected' = 'ok';
const calls: Call[] = [];
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: any, init?: any) => {
  if (!String(url).includes('api.telegram.org')) return realFetch(url, init);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ url: String(url), body });
  if (mode === 'offline') throw new Error('network_down');
  if (mode === 'rejected') return new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

/** Подписанный владелец: маршрут берёт chat_id только из проверенного ID. */
async function owner(telegramId: number) {
  const { createHmac } = await import('node:crypto');
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: telegramId, first_name: 'Тест' }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('stub-token').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function main() {
  const { store } = await import('../lib/store');
  const { POST } = await import('../app/api/telegram/report/route');
  const telegramId = 812345678;
  const parentId = String(telegramId);
  const profile = { id: 'p_1', parentId, name: 'Мира', age: 9, band: '8-10', createdAt: Date.now() } as any;
  store.addProfile(profile);
  const initData = await owner(telegramId);

  const req = () => new Request('http://localhost/api/telegram/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
    body: JSON.stringify({ profileId: 'p_1' }),
  });

  // 1. Без согласия отправки нет и Telegram не дёргается.
  let res = await POST(req());
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0, 'без согласия запрос к Telegram не уходит');
  console.log('  ok без согласия Telegram не вызывается');

  // 2. С согласием и доступной сетью — отправка и фиксация времени.
  store.setNotificationSettings(parentId, { enabled: true, frequency: 'weekly', lastSentAt: null });
  res = await POST(req());
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.sent, true);
  assert.equal(calls.length, 1, 'ровно одна отправка');
  assert.equal(calls[0].body.chat_id, parentId, 'сообщение уходит взрослому, а не в произвольный чат');
  const saved = store.notificationSettings(parentId);
  assert.ok(typeof saved?.lastSentAt === 'number', 'время отправки сохранено');
  console.log('  ok согласие + отправка: время зафиксировано');

  // 3. Повтор раньше срока отклоняется сервером.
  res = await POST(req());
  data = await res.json();
  assert.equal(res.status, 409);
  assert.equal(data.error, 'too_soon');
  assert.ok(String(data.message).includes('Следующий можно через'), 'сказано, сколько ждать');
  assert.equal(calls.length, 1, 'повторный запрос к Telegram не ушёл');
  console.log('  ok повтор раньше недели не уходит в Telegram');

  // 4. Сбой сети не съедает право на отчёт и не роняет маршрут.
  store.setNotificationSettings(parentId, { enabled: true, frequency: 'weekly', lastSentAt: null });
  mode = 'offline';
  res = await POST(req());
  data = await res.json();
  assert.equal(res.status, 200, 'сбой сети не превращается в 500');
  assert.equal(data.sent, false);
  assert.equal(data.telegram, 'not_delivered');
  assert.equal(store.notificationSettings(parentId)?.lastSentAt, null, 'неудачная попытка не тратит частоту');
  console.log('  ok сбой сети: мягкий ответ, частота не потрачена');

  // 5. Отказ Telegram тоже не роняет маршрут.
  mode = 'rejected';
  res = await POST(req());
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.sent, false);
  assert.equal(data.telegram, 'chat not found', 'причина отказа передана');
  assert.equal(store.notificationSettings(parentId)?.lastSentAt, null, 'отказ не тратит частоту');
  console.log('  ok отказ Telegram обработан без падения');

  // 6. Отзыв согласия снова блокирует отправку.
  mode = 'ok';
  store.setNotificationSettings(parentId, { enabled: false, frequency: 'off', lastSentAt: null });
  res = await POST(req());
  assert.equal(res.status, 409);
  assert.equal(calls.length, 3, 'после отзыва новых отправок нет');
  console.log('  ok отзыв согласия блокирует отправку');

  console.log('  ok отчёт: согласие, частота на сервере, сбои сети и отказ Telegram');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
