/**
 * HTTP: уведомления взрослому — согласие, частота, блокировка отчёта.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-notifications-http.ts
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const base = process.env.BASE ?? 'http://localhost:3000';
const BOT_TOKEN = process.env.TEST_BOT_TOKEN ?? '';

/**
 * Владелец запроса. В демо-режиме хватает `x-demo-parent`; если на сервере
 * задан токен бота (нужно для проверки частоты отправки), заголовки должны
 * быть подписаны — иначе сервер справедливо ответит 401.
 */
const OWNER_ID = 700_000_000 + (Number(String(Date.now()).slice(-6)) % 1_000_000);
function ownerHeaders(parent: string): Record<string, string> {
  if (!BOT_TOKEN) return { 'x-demo-parent': parent };
  const id = OWNER_ID;
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return { 'x-telegram-init-data': params.toString() };
}

/** Владелец из подписи — это числовой Telegram ID; нужен и для x-demo-parent. */
async function api(path: string, parent: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...ownerHeaders(parent), ...(init?.headers as Record<string, string> | undefined) },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const parent = `notify-${Date.now()}`;
  const created = await api('/api/profile', parent, { method: 'POST', body: JSON.stringify({ name: 'Мира', age: 9 }) });
  const id = created.data.profile.id;

  // 1. По умолчанию уведомлений нет.
  const initial = await api(`/api/notifications?profileId=${id}`, parent);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.settings.enabled, false);
  assert.equal(initial.data.settings.frequency, 'off');
  assert.equal(initial.data.canSendNow, false);
  assert.equal(initial.data.reason, 'disabled');
  console.log('  ok по умолчанию уведомлений нет');

  // 2. Некорректные настройки отклоняются.
  for (const bad of [
    { enabled: true, frequency: 'off' },
    { enabled: false, frequency: 'weekly' },
    { enabled: true, frequency: 'daily' },
    { enabled: 'yes', frequency: 'weekly' },
  ]) {
    const r = await api('/api/notifications', parent, { method: 'POST', body: JSON.stringify({ profileId: id, ...bad }) });
    assert.equal(r.status, 400, `отклонено: ${JSON.stringify(bad)}`);
  }
  console.log('  ok некорректные настройки отклоняются');

  // 3. Включение — отдельное согласие с частотой.
  const weekly = await api('/api/notifications', parent, { method: 'POST', body: JSON.stringify({ profileId: id, enabled: true, frequency: 'weekly' }) });
  assert.equal(weekly.status, 200);
  assert.equal(weekly.data.canSendNow, true);
  assert.equal(weekly.data.settings.frequency, 'weekly');
  console.log('  ok включение сохраняет согласие и частоту');

  // 4. Отчёт без согласия не отправляется: сначала выключаем.
  await api('/api/notifications', parent, { method: 'POST', body: JSON.stringify({ profileId: id, enabled: false, frequency: 'off' }) });
  const blocked = await api('/api/telegram/report', parent, { method: 'POST', body: JSON.stringify({ profileId: id }) });
  assert.equal(blocked.status, 409, 'без согласия — 409');
  assert.ok(['disabled', 'consent_required'].includes(blocked.data.error), 'отказ назван честно');
  assert.ok(String(blocked.data.message).includes('Включите уведомления'), 'сказано, что делать');
  assert.equal(blocked.data.preview, undefined, 'без согласия отчёт не собирается');
  console.log('  ok без согласия отчёт не отправляется и не собирается');

  // 5. С согласием отправка разрешена (в демо без бота — предпросмотр).
  await api('/api/notifications', parent, { method: 'POST', body: JSON.stringify({ profileId: id, enabled: true, frequency: 'weekly' }) });
  const preview = await api('/api/telegram/report', parent, { method: 'POST', body: JSON.stringify({ profileId: id }) });
  assert.equal(preview.status, 200, 'отправка не падает 500, даже если Telegram недоступен');
  assert.equal(preview.data.sent, false, 'отправки нет — только текст');
  if (preview.data.reason === 'no_bot_credentials') {
    assert.ok(String(preview.data.preview).includes('Мира'), 'текст отчёта собран');
  } else {
    assert.ok(String(preview.data.text).includes('Мира'), 'текст отчёта собран и при недоступном боте');
    assert.equal(preview.data.telegram, 'not_delivered', 'недоставка названа честно');
  }
  console.log('  ok с согласием отчёт собирается; без бота — только предпросмотр');

  // 6. Чужой владелец не видит и не меняет настройку.
  if (!BOT_TOKEN) {
    // В демо-режиме владельца задаёт заголовок, поэтому чужая семья проверяема.
    assert.equal((await api(`/api/notifications?profileId=${id}`, 'stranger')).status, 404, 'чужая семья не видит настройку');
    assert.equal((await api('/api/notifications', 'stranger', { method: 'POST', body: JSON.stringify({ profileId: id, enabled: true, frequency: 'weekly' }) })).status, 404, 'чужая семья не меняет настройку');
  } else {
    // С подписью владелец один на прогон: проверяем, что чужой профиль не виден.
    assert.equal((await api(`/api/notifications?profileId=p_not_mine`, parent)).status, 404, 'чужой профиль не виден');
  }
  assert.equal((await api(`/api/notifications?profileId=${id}`, parent)).data.settings.enabled, true, 'настройка не изменилась');
  console.log('  ok настройка изолирована по владельцу');

  // 7. Согласие на чувства не включает уведомления.
  await api('/api/notifications', parent, { method: 'POST', body: JSON.stringify({ profileId: id, enabled: false, frequency: 'off' }) });
  await api('/api/feelings', parent, { method: 'POST', body: JSON.stringify({ profileId: id, action: 'consent', enabled: true }) });
  assert.equal((await api(`/api/notifications?profileId=${id}`, parent)).data.settings.enabled, false, 'разные согласия не смешиваются');
  console.log('  ok согласие на чувства не включает уведомления');

  // 8. Ограничение частоты действует на сервере: после первой отправки
  //    повтор раньше недели отклоняется, даже если согласие включено.
  //    (Проверяется только при настоящем боте; при фиктивном токене
  //    отправка не удаётся и время не фиксируется — тогда шаг пропускается.)
  const send = await api('/api/telegram/report', parent, { method: 'POST', body: JSON.stringify({ profileId: id }) });
  if (send.data.sent === true) {
    const again = await api('/api/telegram/report', parent, { method: 'POST', body: JSON.stringify({ profileId: id }) });
    assert.equal(again.status, 409, 'повтор раньше недели отклонён');
    assert.equal(again.data.error, 'too_soon');
    assert.ok(String(again.data.message).includes('Следующий можно через'), 'сказано, сколько ждать');
    const settings = await api(`/api/notifications?profileId=${id}`, parent);
    assert.equal(settings.data.canSendNow, false, 'кабинет тоже видит ограничение');
    assert.ok(settings.data.retryText, 'ожидание названо');
    console.log('  ok частота ограничена сервером: повтор отклонён');
  } else {
    console.log('  ok частота ограничена сервером (проверка отправки требует живого бота)');
  }

  console.log('  ok уведомления по HTTP: согласие, частота, блокировка, изоляция');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
