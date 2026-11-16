/**
 * Документы и чек: то, что нельзя оставить «на потом» при приёме денег.
 *
 * Зачем тест. Юридический текст — единственное место в продукте, где ошибка
 * не падает и не видна в интерфейсе, но стоит дорого: цена в оферте, не
 * совпадающая с тарифом; согласие, не связанное с редакцией; чек без суммы.
 * Проверка сверяет документы с кодом, а не с текстом документа.
 *
 * Что проверяется:
 *  1. Цена, срок и число бесплатных встреч в оферте совпадают с тарифом и
 *     правилом доступа.
 *  2. Согласие ссылается на ту же редакцию, что и политика.
 *  3. Реквизиты оператора честно помечены как незаполненные и перечислены.
 *  4. Чек собирается из суммы платежа, а не из запроса; без ставки или почты
 *     не собирается вовсе.
 *  5. В документах нет обещаний результата и медицинских слов.
 *
 * Запуск: npm run test:legal
 */

import { strict as assert } from 'node:assert';
import { LEGAL_DOCUMENTS, OFFER_FACTS, OPERATOR, legalDocument, legalMissing, legalReady } from '../lib/legal/documents.ts';
import { CONSENT_VERSION, CONSENT_POINTS, hasConsent, newConsent, consentOutdated } from '../lib/legal/consent.ts';
import { buildReceipt, receiptConfig, validEmail, VAT_CODES } from '../lib/billing/receipt.ts';
import { PLANS, planById } from '../lib/content/plans.ts';
import { FREE_LESSONS, SUBSCRIPTION_DAYS } from '../lib/access/entitlement.ts';
import { MEETING_MINUTES } from '../lib/year/meeting.ts';
import { YEAR } from '../lib/content/year/index.ts';

const check = (condition: unknown, message: string) => { assert.ok(condition, message); console.log('  ok', message); };

/* ---- 1. Числа в оферте = числа в коде ---- */

const month = planById('month');
check(OFFER_FACTS.priceRub === month.price, 'цена в оферте совпадает с тарифом');
check(OFFER_FACTS.days === month.days && month.days === SUBSCRIPTION_DAYS, 'срок доступа в оферте, тарифе и правиле доступа один');
check(OFFER_FACTS.freeLessons === FREE_LESSONS, 'число бесплатных встреч в оферте совпадает с правилом доступа');
check(OFFER_FACTS.meetingMinutes === MEETING_MINUTES, 'длина встречи в оферте совпадает с планом');
check(OFFER_FACTS.lessonsInYear === YEAR.lessons.length, 'число встреч в году в оферте совпадает с сеткой');
check(PLANS.year_pro.perks.every((perk) => !/нейропсихолог|разбор с экспертом/i.test(perk)), 'тариф с экспертом больше не обещает разборы специалиста');

/* ---- 2. Документы и версии ---- */

check(LEGAL_DOCUMENTS.length === 4, 'четыре документа: политика, оферта, возврат, согласие');
for (const id of ['privacy', 'terms', 'refund', 'consent'] as const) check(!!legalDocument(id), `документ «${id}» существует`);
const privacy = legalDocument('privacy')!;
const consent = legalDocument('consent')!;
check(privacy.version === CONSENT_VERSION, 'политика и согласие — одна редакция: иначе согласие относится к другому тексту');
check(consent.version === CONSENT_VERSION, 'версия согласия совпадает с константой согласия');
for (const document of LEGAL_DOCUMENTS) {
  check(document.sections.length >= 3, `${document.id}: разделов не меньше трёх`);
  check(document.sections.every((section) => section.paragraphs.length > 0), `${document.id}: нет пустых разделов`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(document.version), `${document.id}: версия — дата`);
}

/* ---- 3. Содержание: то, что обещать нельзя ---- */

const allText = LEGAL_DOCUMENTS.flatMap((document) => [document.title, document.summary, ...document.sections.flatMap((section) => [section.heading, ...section.paragraphs])]).join(' ');
/*
 * Проверяется утверждение, а не корень слова. В оферте есть честная фраза
 * «сервис не обещает … лечения» — запрещать в документах саму лексему значит
 * запретить отрицание, то есть заставить документ молчать о том, чего он не
 * делает. Поэтому ищем формы, в которых продукт **присваивает** себе лечение,
 * диагностику или коррекцию.
 */
const CLAIMS = [
  /мы (лечим|диагностируем|корректируем)/i,
  /программа (лечит|корректирует|диагностирует)/i,
  /(терапия|диагностика|коррекция) (ребёнка|поведения|развития)/i,
  /повышает успеваемость/i,
  /гарантиру\w* (результат|оценки|рост)/i,
];
for (const pattern of CLAIMS) check(!pattern.test(allText), `в документах нет утверждения ${pattern}`);
check(!/\bIQ\b/.test(allText.replace('роста IQ', '')), 'в документах нет обещания IQ');
check(/не обещает повышения оценок/.test(allText), 'и при этом прямо названо, чего сервис не обещает');
const terms = legalDocument('terms')!;
const termsText = terms.sections.flatMap((section) => section.paragraphs).join(' ');
check(/не обещает/i.test(termsText), 'оферта прямо говорит, чего сервис не обещает');
check(/автоматическ[а-я]* продления нет/i.test(termsText) || /автоматического списания и автоматического продления нет/i.test(termsText), 'оферта называет отсутствие автопродления');

/* ---- 4. Реквизиты: незаполненное названо ---- */

const missing = legalMissing(OPERATOR);
if (!legalReady(OPERATOR)) {
  check(missing.length > 0, 'если реквизиты не заполнены — они перечислены, а не скрыты');
  check(missing.every((item) => typeof item === 'string' && item.length > 3), 'каждый недостающий пункт назван словами');
} else {
  check(legalReady(OPERATOR), 'реквизиты заполнены полностью');
}
check(!legalReady({ name: 'ИП', registration: '', address: 'Москва', email: 'a@b.ru' }), 'неполные реквизиты не считаются готовыми');
check(legalReady({ name: 'ИП Иванов', registration: '123456789012', address: 'Москва', email: 'a@b.ru' }), 'полные реквизиты считаются готовыми');
check(!legalReady({ name: 'ИП', registration: '1', address: 'М', email: 'не-почта' }), 'почта проверяется');

/* ---- 5. Чек ---- */

check(receiptConfig({}) === null, 'без ставки НДС чек не настраивается');
check(receiptConfig({ GIB_RECEIPT_VAT_CODE: '99' }) === null, 'недопустимый код НДС отклоняется');
check(receiptConfig({ GIB_RECEIPT_VAT_CODE: '1' })?.vatCode === 1, 'допустимый код НДС принимается');
check(VAT_CODES.length === 6, 'коды НДС перечислены все');
check(validEmail('parent@example.ru') && !validEmail('parent@') && !validEmail('нет почты'), 'почта проверяется');

const config = receiptConfig({ GIB_RECEIPT_VAT_CODE: '1' })!;
const receipt = buildReceipt({ amount: '599.00', currency: 'RUB', description: 'Доступ к «ГИБ»: 30 дней', config, customerEmail: 'parent@example.ru' });
check(receipt.items.length === 1 && receipt.items[0].quantity === '1.00', 'в чеке одна позиция, количество 1');
check(receipt.items[0].amount.value === '599.00' && receipt.items[0].amount.currency === 'RUB', 'сумма чека равна сумме платежа');
check(receipt.customer.email === 'parent@example.ru', 'чек привязан к почте покупателя');
for (const bad of ['599', '599.0', '599,00', '-599.00', ''] as const) {
  let failed = false;
  try { buildReceipt({ amount: bad, currency: 'RUB', description: 'Доступ', config, customerEmail: 'p@e.ru' }); } catch { failed = true; }
  check(failed, `сумма «${bad}» отклоняется, а не обрезается`);
}
let badEmail = false;
try { buildReceipt({ amount: '599.00', currency: 'RUB', description: 'Доступ', config, customerEmail: 'нет' }); } catch { badEmail = true; }
check(badEmail, 'чек без почты не собирается');

/* ---- 6. Согласие связано с документом ---- */

check(CONSENT_POINTS.length >= 3, 'в согласии перечислено, что подтверждает взрослый');
check(CONSENT_POINTS.every((point) => point.length > 20), 'каждый пункт согласия — фраза, а не слово');
check(hasConsent({ guardianConsent: newConsent(1_800_000_000_000) }), 'запись согласия читается');
check(!consentOutdated({ guardianConsent: { version: CONSENT_VERSION, at: 1 } }), 'согласие действующей редакции не устарело');
check(consentOutdated({ guardianConsent: { version: '2020-01-01', at: 1 } }), 'согласие прошлой редакции устарело');

console.log('✓ документы: числа совпадают с кодом, чек собирается, незаполненное названо');
