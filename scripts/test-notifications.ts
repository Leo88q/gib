import assert from 'node:assert/strict';
import {
  canSend, DEFAULT_NOTIFICATIONS, FREQUENCY_MS, validSettings, validFrequency, waitText,
  type NotificationSettings,
} from '../lib/family/notifications';

const now = 1_800_000_000_000;
const weekly: NotificationSettings = { enabled: true, frequency: 'weekly', lastSentAt: null };

// 1. По умолчанию уведомлений нет.
assert.equal(DEFAULT_NOTIFICATIONS.enabled, false);
assert.equal(DEFAULT_NOTIFICATIONS.frequency, 'off');
assert.equal(canSend(DEFAULT_NOTIFICATIONS, true, now).allowed, false, 'выключено — не отправляем');

// 2. Без согласия не отправляется даже включённая настройка.
assert.equal(canSend(weekly, false, now).allowed, false, 'без согласия — нет');
assert.deepEqual(canSend(weekly, false, now), { allowed: false, reason: 'consent_required' });
assert.equal(canSend(weekly, true, now).allowed, true, 'согласие и включено — можно');

// 3. Частота соблюдается на сервере.
const sentRecently: NotificationSettings = { ...weekly, lastSentAt: now - 1000 };
const tooSoon = canSend(sentRecently, true, now);
assert.equal(tooSoon.allowed, false);
assert.equal(tooSoon.allowed === false && tooSoon.reason, 'too_soon');
assert.ok(tooSoon.allowed === false && (tooSoon.retryAfterMs ?? 0) > 0, 'сказано, сколько ждать');
assert.equal(canSend(sentRecently, true, now + FREQUENCY_MS.weekly).allowed, true, 'через неделю — можно');

// 4. Месячная частота строже недельной.
const monthly: NotificationSettings = { enabled: true, frequency: 'monthly', lastSentAt: now - FREQUENCY_MS.weekly - 1 };
assert.equal(canSend(monthly, true, now).allowed, false, 'месяц ещё не прошёл');
assert.equal(canSend(monthly, true, now + FREQUENCY_MS.monthly).allowed, true);

// 5. Включённое без частоты недопустимо, выключенное с частотой — тоже.
assert.equal(validSettings(DEFAULT_NOTIFICATIONS), true);
assert.equal(validSettings(weekly), true);
assert.equal(validSettings({ enabled: true, frequency: 'off', lastSentAt: null }), false, 'включено без частоты');
assert.equal(validSettings({ enabled: false, frequency: 'weekly', lastSentAt: null }), false, 'выключено с частотой');
assert.equal(validSettings({ enabled: true, frequency: 'daily', lastSentAt: null }), false, 'ежедневно не существует');
assert.equal(validSettings({ enabled: true, frequency: 'weekly', lastSentAt: -5 }), false, 'отрицательное время');
assert.equal(validSettings({ enabled: true, frequency: 'weekly', lastSentAt: null, extra: 1 }), false, 'лишние поля');
assert.equal(validSettings(null), false);
assert.equal(validSettings({}), false);

// 6. Нет частоты «каждый день»: это защита от давления на ребёнка.
assert.deepEqual(Object.keys(FREQUENCY_MS).sort(), ['monthly', 'weekly']);
for (const bad of ['daily', 'hourly', 'always', '', null, 1]) assert.equal(validFrequency(bad), false, `${String(bad)} недопустимо`);

// 7. Мусорное время последней отправки не ломает проверку.
assert.equal(canSend({ enabled: true, frequency: 'weekly', lastSentAt: Number.NaN }, true, now).allowed, true);
assert.equal(canSend({ enabled: true, frequency: 'weekly', lastSentAt: null }, true, now).allowed, true);

// 8. Текст ожидания человеческий и без давления.
assert.equal(waitText(90_000), '2 мин.');
assert.equal(waitText(3 * 60 * 60 * 1000), '3 ч.');
assert.equal(waitText(5 * 24 * 60 * 60 * 1000), '5 дн.');
assert.ok(!/должен|обязан|пропуск/i.test(waitText(86_400_000)), 'без вины и обязательств');

console.log('  ok уведомления: согласие, частота, валидация, текст ожидания');
