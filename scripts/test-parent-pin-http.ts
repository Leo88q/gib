/**
 * HTTP-проверка кода взрослого на одноразовом сервере в демо-режиме.
 * Запуск: BASE=http://127.0.0.1:<порт> npx tsx scripts/test-parent-pin-http.ts
 */
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3000';

async function call(parent: string, body?: object, method?: string) {
  const res = await fetch(base + '/api/parent-pin', {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-demo-parent': parent },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const parent = `pin-${Date.now()}`;

  // 1. До настройки PIN не задан — кабинет открыт, как раньше.
  const initial = await call(parent);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.configured, false);
  assert.equal(initial.data.locked, false);
  console.log('  ok по умолчанию код не задан');

  // 2. Формат проверяется.
  for (const bad of ['123', '123456789', 'abcd', '12a4', '']) {
    const res = await call(parent, { action: 'set', pin: bad });
    assert.equal(res.status, 400, `формат отклонён: ${JSON.stringify(bad)}`);
  }
  console.log('  ok некорректный формат отклоняется');

  // 3. Очевидный PIN не принимается.
  for (const weak of ['1111', '1234', '0000']) {
    const res = await call(parent, { action: 'set', pin: weak });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'weak_pin');
  }
  console.log('  ok очевидные коды отклоняются');

  // 4. Хороший PIN сохраняется, сам код не возвращается.
  const set = await call(parent, { action: 'set', pin: '5839' });
  assert.equal(set.status, 200);
  assert.equal(set.data.configured, true);
  assert.ok(!JSON.stringify(set.data).includes('5839'), 'PIN не отдаётся в ответе');
  const status = await call(parent);
  assert.equal(status.data.configured, true);
  assert.ok(!JSON.stringify(status.data).includes('hash'), 'хеш не отдаётся');
  console.log('  ok код сохранён, сам код и хеш наружу не уходят');

  // 5. Проверка: неверный и верный.
  const wrong = await call(parent, { action: 'verify', pin: '1112' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'pin_invalid');
  const ok = await call(parent, { action: 'verify', pin: '5839' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.ok(ok.data.sessionMs > 0, 'время сессии кабинета указано');
  console.log('  ok верный код открывает кабинет, неверный — нет');

  // 6. Повторно задать код без текущего нельзя.
  const overwrite = await call(parent, { action: 'set', pin: '7492' });
  assert.equal(overwrite.status, 400);
  assert.equal(overwrite.data.error, 'current_required');
  const wrongCurrent = await call(parent, { action: 'set', pin: '7492', current: '1112' });
  assert.equal(wrongCurrent.status, 401);
  assert.equal(wrongCurrent.data.error, 'current_invalid');
  const changed = await call(parent, { action: 'set', pin: '7492', current: '5839' });
  assert.equal(changed.status, 200);
  assert.equal((await call(parent, { action: 'verify', pin: '5839' })).status, 401, 'старый код больше не действует');
  assert.equal((await call(parent, { action: 'verify', pin: '7492' })).status, 200, 'новый код работает');
  console.log('  ok смена кода требует текущий код');

  // 7. Серия неудач блокирует вход.
  for (let i = 0; i < 5; i++) await call(parent, { action: 'verify', pin: '1113' });
  const locked = await call(parent, { action: 'verify', pin: '7492' });
  assert.equal(locked.status, 429, 'блокировка после серии неудач');
  assert.equal(locked.data.error, 'pin_locked');
  assert.ok(locked.data.retryAfterMs > 0, 'сказано, сколько ждать');
  const lockedStatus = await call(parent);
  assert.equal(lockedStatus.data.locked, true, 'состояние блокировки видно клиенту');
  console.log('  ok после пяти неудач вход блокируется');

  // 8. Чужой владелец не видит и не меняет код.
  const foreign = await call('foreign');
  assert.equal(foreign.data.configured, false, 'у чужого владельца свой код');
  assert.equal((await call('foreign', { action: 'verify', pin: '7492' })).status, 404, 'чужой код не подходит');
  console.log('  ok код изолирован по владельцу');

  // 9. Удаление возвращает кабинет к открытому виду.
  const removed = await call(parent, undefined, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(removed.data.configured, false);
  assert.equal((await call(parent)).data.configured, false);
  assert.equal((await call(parent, undefined, 'DELETE')).status, 404, 'повторное удаление — 404');
  console.log('  ok удаление кода возвращает прежнее поведение');

  // 10. В демо-режиме запрос без заголовков получает демо-владельца, а не 401:
  //     это ожидаемое поведение демо, поэтому проверяем именно его.
  const anon = await fetch(base + '/api/parent-pin');
  const anonData = await anon.json();
  assert.equal(anon.status, 200);
  assert.equal(anonData.configured, false, 'демо-владелец по умолчанию без кода');
  console.log('  ok демо-режим: владелец по умолчанию без кода');

  console.log('  ok код взрослого по HTTP: формат, слабые коды, смена, блокировка, изоляция, удаление');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
