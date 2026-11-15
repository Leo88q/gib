/**
 * Доступ: что открыто бесплатно, что закрыто оплатой и кому.
 *
 * Зачем тест. До него оплата не закрывала ничего: подписка оформлялась, а
 * занятие отдавалось любому владельцу профиля. Ошибка в этом месте не видна
 * ни в интерфейсе, ни в тестах оплаты: деньги приходят, доступ остаётся
 * полным, и продукт продаёт то, что и так работает.
 *
 * Что проверяется:
 *  1. Первые встречи открыты, следующие — нет.
 *  2. Действующая оплата открывает всё; просроченная и «демо» — нет.
 *  3. Начатое занятие не закрывается на середине: отказ только на старте.
 *  4. Повтор пройденного занятия открыт всегда.
 *  5. В режиме «ребёнок сам» встречи не продаются и не блокируются оплатой.
 *  6. Тексты отказа не обещают и не давят.
 *
 * Запуск: npm run test:access
 */

import { strict as assert } from 'node:assert';
import {
  FREE_LESSONS, SUBSCRIPTION_DAYS, activeSubscription, entitlementFor, mayStartLesson,
  paywallCopy, entitlementSummary,
} from '../lib/access/entitlement.ts';
import type { Subscription } from '../lib/types.ts';

const NOW = 1_800_000_000_000;
const active = (until = NOW + 5 * 86400000): Subscription => ({ profileId: 'p', plan: 'month', status: 'active', startedAt: NOW - 86400000, until });
const check = (condition: unknown, message: string) => { assert.ok(condition, message); console.log('  ok', message); };

/* ---- 1. Что открыто без оплаты ---- */

check(FREE_LESSONS === 1, 'без оплаты открыта ровно одна встреча');
const first = entitlementFor({ lessonNumber: 1, lead: 'adult', subscription: undefined, now: NOW });
check(first.level === 'free' && first.free && first.reason === 'free_lesson', 'первая встреча открыта и помечена бесплатной');
check(mayStartLesson(first), 'первую встречу можно начать без оплаты');
const second = entitlementFor({ lessonNumber: 2, lead: 'adult', subscription: undefined, now: NOW });
check(second.level === 'paid' && second.reason === 'payment_required', 'вторая встреча без оплаты закрыта');
check(!mayStartLesson(second), 'вторую встречу без оплаты начать нельзя');
check(second.paywallAfterLesson === FREE_LESSONS, 'экран оплаты появляется после первой встречи');

/* ---- 2. Что открывает оплата ---- */

check(activeSubscription(active(), NOW), 'действующая оплата считается активной');
const paid = entitlementFor({ lessonNumber: 20, lead: 'adult', subscription: active(), now: NOW });
check(paid.level === 'free' && paid.reason === 'subscribed', 'оплата открывает двадцатую встречу');
check(mayStartLesson(paid), 'и её можно начать');
check(!activeSubscription(active(NOW - 1), NOW), 'просроченная оплата не действует');
check(!activeSubscription({ ...active(), status: 'expired' }, NOW), 'закрытая подписка не действует даже внутри срока');
check(!activeSubscription(undefined, NOW), 'без записи подписки доступа нет');
check(SUBSCRIPTION_DAYS === 30, 'оплата даёт 30 дней');

/* ---- 3. Отказ не рубит начатое занятие ---- */

/*
 * `mayStartLesson` — решение только о новом занятии. Уже начатая сессия
 * продолжается: в маршруте ответ на шаг не проверяет подписку, и это
 * намеренно. Здесь фиксируем контракт, чтобы его не «улучшили» проверкой на
 * каждом шаге.
 */
const expiredMidway = entitlementFor({ lessonNumber: 12, lead: 'adult', subscription: active(NOW - 1000), now: NOW });
check(!mayStartLesson(expiredMidway), 'просроченная оплата не даёт начать новую встречу');
check(mayStartLesson(expiredMidway, { repeat: true }), 'но повтор пройденного открыт: это не новое содержание');

/* ---- 4. Режим «ребёнок сам» ---- */

const childMode = entitlementFor({ lessonNumber: 5, lead: 'child', subscription: undefined, now: NOW });
check(childMode.reason === 'meetings_not_in_mode', 'в коротком режиме встречи не продаются');
check(childMode.paywallAfterLesson === null, 'и экран оплаты к ним не привязан');
check(paywallCopy(childMode.reason).title.includes('не входят'), 'взрослому сказано, что встречи не входят в его режим');
const childPaid = entitlementFor({ lessonNumber: 5, lead: 'child', subscription: active(), now: NOW });
check(childPaid.level === 'free', 'оплативший взрослый не блокируется независимо от режима');

/* ---- 5. Границы и устойчивость ---- */

check(entitlementFor({ lessonNumber: 0, lead: 'adult', subscription: undefined, now: NOW }).lessonNumber === 1, 'нулевой номер занятия приводится к первому');
check(entitlementFor({ lessonNumber: Number.NaN, lead: 'adult', subscription: undefined, now: NOW }).lessonNumber === 1, 'NaN не ломает проверку доступа');

/* ---- 6. Тексты отказа ---- */

const copy = paywallCopy('payment_required');
check(/Первая встреча/.test(copy.body), 'отказ начинается с того, что уже открыто');
check(!/скидк|осталось|только сегодня|спешите/i.test(copy.body + copy.title), 'в отказе нет давления и таймеров');
check(!/диагност|терап|коррекц/i.test(copy.body + copy.title), 'в отказе нет медицинских слов');
check(entitlementSummary(first).includes('Первая встреча'), 'сводка для карточки тарифа объясняет, что открыто');

console.log('✓ доступ: одна встреча бесплатно, оплата открывает остальные, начатое не отбирается');
