import assert from 'node:assert/strict';
import {
  checkPin, hashPin, validPin, weakPin, validParentPin, validParentSession,
  MAX_PIN_ATTEMPTS, PIN_LOCK_MS, PARENT_SESSION_MS,
} from '../lib/family/roles';
import { validateStore } from '../lib/store-validation';

const now = Date.UTC(2026, 10, 4, 12, 0, 0);

// 1. Формат PIN: только цифры, 4–8 знаков.
{
  for (const good of ['1234', '583920', '83647291']) assert.ok(validPin(good), good);
  for (const bad of ['123', '123456789', 'abcd', '12a4', '', ' 1234', '1234 ', null, 1234, undefined]) assert.equal(validPin(bad), false, String(bad));
}

// 2. Очевидные PIN отклоняются: ребёнок пробует их первыми.
{
  for (const weak of ['1111', '0000', '9999', '1234', '4321', '123456', '98765432']) assert.ok(weakPin(weak), `${weak} — слабый`);
  for (const ok of ['1947', '5839', '7071', '1853']) assert.equal(weakPin(ok), false, `${ok} — подходит`);
}

// 3. PIN не хранится в открытом виде.
{
  const pin = hashPin('5839');
  assert.equal(JSON.stringify(pin).includes('5839'), false, 'сам PIN не сохранён');
  assert.ok(/^[0-9a-f]{64}$/.test(pin.hash), 'scrypt-хеш в hex');
  assert.equal(pin.failed, 0);
  assert.ok(validParentPin(pin));
  const other = hashPin('5839');
  assert.notEqual(other.salt, pin.salt, 'соль случайная');
  assert.notEqual(other.hash, pin.hash, 'одинаковый PIN даёт разные хеши');
}

// 4. Проверка: верный открывает, неверный не открывает.
{
  const stored = hashPin('5839');
  assert.deepEqual(checkPin(stored, '5839', now).result, { ok: true });
  const wrong = checkPin(stored, '5830', now);
  assert.equal(wrong.result.ok, false);
  assert.equal((wrong.result as { reason: string }).reason, 'invalid');
  assert.equal(wrong.next.failed, 1, 'неудачная попытка записана');
  assert.equal((checkPin(wrong.next, '1111', now).next.failed), 2, 'мусорный PIN тоже считается попыткой');
}

// 5. После серии неудач вход блокируется на время.
{
  let state = hashPin('5839');
  for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) state = checkPin(state, '0000', now).next;
  assert.equal(state.failed, MAX_PIN_ATTEMPTS - 1);
  assert.equal(state.lockedUntil, undefined, 'до лимита блокировки нет');
  state = checkPin(state, '0000', now).next;
  assert.equal(state.lockedUntil, now + PIN_LOCK_MS, 'после лимита — блокировка');
  const locked = checkPin(state, '5839', now + 1000);
  assert.equal(locked.result.ok, false);
  assert.equal((locked.result as { reason: string }).reason, 'locked');
  assert.equal(locked.result.ok, false);
  const retryAfterMs = locked.result.ok ? 0 : (locked.result.retryAfterMs ?? 0);
  assert.ok(retryAfterMs > 0 && retryAfterMs < PIN_LOCK_MS, 'сказано, сколько ждать');
  // Даже верный PIN не проходит во время блокировки — иначе подбор продолжается.
  const after = checkPin(state, '5839', now + PIN_LOCK_MS + 1);
  assert.deepEqual(after.result, { ok: true }, 'после блокировки верный PIN открывает');
  assert.equal(after.next.failed, 0, 'успех сбрасывает счётчик');
}

// 6. Успех сбрасывает неудачные попытки.
{
  const first = checkPin(hashPin('5839'), '0000', now).next;
  assert.equal(first.failed, 1);
  assert.equal(checkPin(first, '5839', now).next.failed, 0);
}

// 7. Мусор в сохранённом PIN не проходит валидацию.
{
  const good = hashPin('5839');
  assert.equal(validParentPin({ ...good, hash: 'короткий' }), false);
  assert.equal(validParentPin({ ...good, salt: 'zz' }), false);
  assert.equal(validParentPin({ ...good, failed: -1 }), false);
  assert.equal(validParentPin({ ...good, extra: 'secret' }), false, 'лишние поля не допускаются');
  assert.equal(validParentPin({ salt: good.salt, hash: good.hash, createdAt: good.createdAt, failed: 0, lockedUntil: 'soon' }), false);
}

// 8. Сессия кабинета короткая и истекает.
{
  assert.ok(validParentSession({ until: now + PARENT_SESSION_MS }, now));
  assert.equal(validParentSession({ until: now - 1 }, now), false, 'истёкшая сессия не действует');
  assert.equal(validParentSession({}, now), false);
  assert.equal(validParentSession(null, now), false);
}

// 9. Хранилище: запись PIN валидируется, дубли владельцев отклоняются.
{
  const record = { parentId: 'owner', pin: hashPin('5839') };
  assert.doesNotThrow(() => validateStore({ profiles: [], sessions: [], parentPins: [record] } as never));
  assert.throws(() => validateStore({ profiles: [], sessions: [], parentPins: [record, record] } as never), /Duplicate store identity/);
  assert.throws(() => validateStore({ profiles: [], sessions: [], parentPins: [{ parentId: 'owner', pin: { salt: 'x', hash: 'y', createdAt: 1, failed: 0 } }] } as never), /Invalid parent pin/);
}

console.log('  ok код взрослого: формат, слабые PIN, хеш, попытки, блокировка и короткая сессия');
