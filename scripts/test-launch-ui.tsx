/**
 * Интерфейс запуска: то, что взрослый видит до первого платежа.
 *
 * Зачем тест. Это экраны, на которых продукт либо объясняет себя, либо теряет
 * взрослого: согласие, два вопроса онбординга, страница «что вы покупаете»,
 * отказ у закрытого занятия, кабинет с чеком и возвратом. Проверять их
 * скриншотами нельзя (в прогоне нет браузера), поэтому проверяется отрендеренная
 * разметка и тексты — и то, чего в них быть не должно.
 *
 * Что проверяется:
 *  1. Страница документов перечисляет четыре документа и честно называет
 *     незаполненные реквизиты.
 *  2. «Что вы покупаете»: 36 встреч, 40 минут, 12 показов, первая встреча
 *     бесплатно, цена из тарифа.
 *  3. Онбординг: согласие нельзя обойти, два вопроса обязательны.
 *  4. Кабинет: почта для чека, согласие с условиями, отмена и возврат различимы.
 *  5. План встречи печатается и говорит, кто его ведёт.
 *  6. Нигде в новых экранах нет обещаний и медицинских слов.
 *
 * Запуск: npm run test:launch-ui
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LegalIndexPage from '../app/legal/page.tsx';
import OfferPage from '../app/offer/page.tsx';
import MeetingPlanCard from '../components/MeetingPlanCard.tsx';
import { meetingPlan } from '../lib/year/meeting.ts';
import { YEAR } from '../lib/content/year/index.ts';
import { MEETING_MINUTES } from '../lib/year/meeting.ts';
import { PLANS } from '../lib/content/plans.ts';
import { LEGAL_DOCUMENTS, OPERATOR, legalReady } from '../lib/legal/documents.ts';

const check = (condition: unknown, message: string) => { assert.ok(condition, message); console.log('  ok', message); };
const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/* ---- 1. Документы ---- */

const legal = render(<LegalIndexPage />);
check(LEGAL_DOCUMENTS.every((document) => legal.includes(document.title)), 'страница документов перечисляет все четыре');
check(legal.includes('href="/legal/privacy"'), 'ссылка на политику есть');
check(legal.includes('href="/legal/refund"'), 'ссылка на возврат есть');
if (!legalReady(OPERATOR)) {
  check(legal.includes('не заполнены'), 'незаполненные реквизиты названы, а не спрятаны');
  check(legal.includes('не заполнено:'), 'перечислено, что именно заполнить');
} else {
  check(legal.includes(OPERATOR.name), 'заполненные реквизиты показаны');
}
check(/не заменяют проверку юристом/i.test(legal), 'страница не выдаёт текст за заключение юриста');

/* ---- 2. Что вы покупаете ---- */

const offer = render(<OfferPage />);
check(offer.includes(`${YEAR.lessons.length} встреч — по одной в неделю`), 'число встреч взято из сетки и названо без двусмысленности');
check(offer.includes(`${MEETING_MINUTES} минут`), 'длина встречи названа в тексте, а не только в плане');
check(offer.includes(String(YEAR.lessons.filter((lesson) => lesson.isShowcase).length)), 'число показов взято из года');
check(offer.includes(String(YEAR.totalDays)), 'число дней практики взято из программы');
check(offer.includes(String(PLANS.month.price)), 'цена совпадает с тарифом');
check(/Первая встреча открыта/i.test(offer), 'сказано, что открыто без оплаты');
check(/автоматического продления нет/i.test(offer), 'сказано, что автопродления нет');
check(/Взрослый открывает его, ведёт по блокам/.test(offer), 'страница объясняет роль взрослого — то, чего не было');
check(/Чего здесь нет/.test(offer) && /Нет оценок ребёнка/.test(offer), 'границы названы прямо');
/*
 * Проверяется утверждение, а не корень слова. На странице есть честная фраза
 * «нет медицинских процедур и диагностики»: запрещать саму лексему значит
 * запретить продукту сказать, чего он не делает.
 */
const offerClaims = [/мы (диагностируем|лечим|корректируем)/i, /(терапия|диагностика|коррекция) (ребёнка|поведения|развития)/i, /нейропсихолог/i, /повышает успеваемость/i];
for (const pattern of offerClaims) check(!pattern.test(offer), `на странице оффера нет утверждения ${pattern}`);
check(/Нет медицинских процедур и диагностики/.test(offer), 'и прямо сказано, чего в продукте нет');

/* ---- 3. Онбординг в главной странице ---- */

const page = read('app/page.tsx');
check(/MEETING_LEAD_QUESTION/.test(page), 'онбординг спрашивает, кто ведёт встречу');
check(/HOUSEHOLD_QUESTION/.test(page), 'онбординг спрашивает про взрослого в семье');
check(/consentAccepted: true/.test(page), 'согласие передаётся на сервер явным полем');
check(/consentVersion: CONSENT_VERSION/.test(page), 'версия согласия передаётся вместе с ним');
check(/disabled=\{saving \|\| !consent\}/.test(page), 'кнопка создания профиля заблокирована без согласия');
check(/CONSENT_POINTS\.map/.test(page), 'текст согласия показан целиком, а не одним предложением');
check(/href="\/legal\/privacy"/.test(page), 'из онбординга есть ссылка на политику');
check(!/legal\">\s*Программа: 12 недель/.test(page), 'старая подпись «демо» больше не выдаёт прототип за продукт');
check(/setNeedsConsent/.test(page), 'профиль без согласия получает экран вместо города');
check(/payment_required/.test(page), 'экран отказа от оплаты обрабатывается отдельно от ошибки связи');

/* ---- 4. Кабинет: чек, отмена, возврат ---- */

const parent = read('app/parent/page.tsx');
check(/Почта для чека/.test(parent), 'кабинет спрашивает почту для чека');
check(/receiptEmail/.test(parent) && /offerAccepted/.test(parent), 'почта и согласие с условиями уходят вместе с оплатой');
check(/href="\/legal\/terms"/.test(parent) && /href="\/legal\/refund"/.test(parent), 'условия и возврат доступны до оплаты');
check(/Отменить доступ сейчас/.test(parent), 'отмена доступа подписана своим действием');
check(/Вернуть деньги/.test(parent), 'возврат — отдельная кнопка');
check(/деньги приходят на карту/.test(parent), 'разница между отменой и возвратом объяснена');
check(/Подтвердить возврат/.test(parent), 'возврат требует второго клика');
check(/receipt_not_configured/.test(parent), 'причина недоступности оплаты показывается словами');
check(!/Год с экспертом'/.test(parent), 'витрина не называет тариф с экспертом продажным');
check(/filter\(\(\[key\]\) => key === 'month'\)/.test(parent), 'продаётся ровно один тариф');

/* ---- 5. План встречи ---- */

const lesson = YEAR.lessons[0];
const planForAdult = meetingPlan(lesson, { lead: 'adult', householdAdult: 'other' });
const planMarkup = render(<MeetingPlanCard plan={planForAdult} />);
check(planMarkup.includes(`Встреча ${lesson.number}`), 'план называет номер встречи');
check(planMarkup.includes(String(MEETING_MINUTES)), 'план показывает общую длину');
check(planMarkup.includes('Распечатать эту встречу'), 'план можно распечатать');
check(/другой взрослый/.test(planMarkup), 'план учитывает, что дома есть другой взрослый');
const planSelf = meetingPlan(lesson, { lead: 'child' });
check(planSelf.audience?.title.includes('самому'), 'режим «ребёнок сам» меняет заголовок плана');
const planNoAdult = meetingPlan(lesson, { householdAdult: 'none' });
check(planNoAdult.audience?.trustedAdult === null, 'если дома взрослого нет, план не отправляет ребёнка к нему');
check(planNoAdult.audience?.household?.includes('нет'), 'и говорит об этом взрослому прямо');
const teacherPlan = meetingPlan(lesson);
check(teacherPlan.audience?.lead === 'adult' && !teacherPlan.audience?.household, 'у педагога план остаётся без семейного поля');
check(planForAdult.blocks.reduce((sum, block) => sum + block.minutes, 0) === MEETING_MINUTES, 'сумма блоков по-прежнему равна длине встречи');

/* ---- 6. Новые экраны в навигации и в метаданных ---- */

const layout = read('app/layout.tsx');
check(/lang="ru"/.test(layout), 'язык страницы русский');
for (const file of ['app/legal/page.tsx', 'app/offer/page.tsx', 'app/legal/[doc]/page.tsx']) {
  check(fs.existsSync(path.join(process.cwd(), file)), `${file} существует`);
}
const docPage = read('app/legal/[doc]/page.tsx');
check(/dynamicParams = false/.test(docPage), 'неизвестный документ даёт 404, а не пустую страницу');

/* ---- 7. Чего в новых экранах быть не должно ---- */

const newSources = [page, parent, offer, legal, planMarkup].join(' ');
for (const pattern of [/мы (диагностируем|лечим|корректируем)/i, /(терапия|диагностика|коррекция) (ребёнка|поведения|развития)/i, /повысит успеваемость/i, /гарантируем результат/i]) {
  check(!pattern.test(newSources), `в новых экранах нет утверждения ${pattern}`);
}
/*
 * Отдельно — запрет медленных надписей на экране ребёнка: там не должно быть
 * ни слова «занятие с психологом», ни приглашения «на терапию».
 */
const childScreen = read('app/page.tsx');
check(!/психолог|терапи/i.test(childScreen), 'на экранах ребёнка нет медицинских слов');
check(!/getFullYear\(\) - 1970|TODO|FIXME|заглушка/i.test(offer + legal + planMarkup), 'в опубликованных страницах нет пометок «заглушка» и TODO');

console.log('✓ интерфейс запуска: согласие, оффер, чек, возврат и план встречи на месте');
