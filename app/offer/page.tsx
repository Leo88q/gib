import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { YEAR } from '@/lib/content/year/index.ts';
import { MEETING_MINUTES, blockTitles } from '@/lib/year/meeting.ts';
import { FREE_LESSONS, SUBSCRIPTION_DAYS } from '@/lib/access/entitlement.ts';
import { OFFER_FACTS } from '@/lib/legal/documents.ts';
import { PLANS } from '@/lib/content/plans.ts';

export const metadata: Metadata = {
  title: 'Что вы покупаете — ГИБ',
  description: `Год из ${YEAR.lessons.length} встреч по ${MEETING_MINUTES} минут и практика в приложении между ними.`,
};

const minutesPerYear = YEAR.lessons.length * MEETING_MINUTES;
const showcaseCount = YEAR.lessons.filter((lesson) => lesson.isShowcase).length;

/**
 * Страница «что вы покупаете».
 *
 * Зачем она. До неё продукт объяснял устройство года только педагогу: план
 * встречи лежал в кабинете педагога, а родитель видел отчёт и кнопку оплаты.
 * Из этого невозможно понять главное — что раз в неделю взрослый ведёт
 * занятие сорок минут, а между ними ребёнок занимается в приложении.
 *
 * Все числа берутся из кода, а не пишутся руками: 36 встреч, 40 минут, 12
 * показов, 60 дней практики. Если сетка изменится, страница изменится вместе
 * с ней, а тест поймает расхождение с офертой.
 */
export default function OfferPage() {
  const blocks = blockTitles(false).map((title, index) => ({ title, minutes: [5, 10, 10, 10, 5][index] }));
  const month = PLANS.month;
  return (
    <main className="page offer-page">
      <h1>Что вы покупаете</h1>
      <p className="offer-lead">
        Год занятий для ребёнка: {YEAR.lessons.length} встреч — по одной в неделю, каждая {MEETING_MINUTES} минут,
        и практика в приложении между ними. Это {minutesPerYear} минут вместе со взрослым и {YEAR.totalDays} коротких
        историй — по одной на день.
      </p>

      <section className="offer-card">
        <h2>Что делает взрослый</h2>
        <p>
          У каждой встречи есть готовый план на {MEETING_MINUTES} минут. Взрослый открывает его, ведёт по блокам и
          закрывает встречу. Готовиться не нужно: план написан репликами, его можно распечатать.
        </p>
        <ol className="offer-blocks">
          {blocks.map((block) => (
            <li key={block.title}>
              <span className="offer-minutes">{block.minutes} мин</span> {block.title}
            </li>
          ))}
        </ol>
        <p className="muted small">
          План не требует педагогического образования. Он требует одного: прийти и провести эти сорок минут.
          Вести встречу может и ребёнок старшего возраста — сам, по тому же плану.
        </p>
      </section>

      <section className="offer-card">
        <h2>Что делает ребёнок</h2>
        <p>
          Между встречами — короткая история и одно задание, {YEAR.totalDays} дней на год. История предлагает
          вымышленную ситуацию и три варианта действий. Правильного ответа нет, оценок нет, награда одинаковая
          за любой выбор.
        </p>
        <p className="muted small">
          Ребёнок может отказаться от упражнения и от разговора. Отказ не влияет ни на доступ, ни на награды.
        </p>
      </section>

      <section className="offer-card">
        <h2>Что показывает год</h2>
        <ul className="offer-facts">
          <li><strong>{YEAR.lessons.length}</strong> встреч, из них <strong>{showcaseCount}</strong> — показы для своих</li>
          <li><strong>{MEETING_MINUTES}</strong> минут одна встреча, <strong>{minutesPerYear}</strong> минут за год</li>
          <li><strong>{YEAR.totalDays}</strong> дней практики в приложении</li>
          <li>Три возрастные линейки: 5–7, 8–10, 11–13 лет</li>
        </ul>
      </section>

      <section className="offer-card">
        <h2>Бесплатно и по подписке</h2>
        <p>
          Первая встреча открыта целиком и без оплаты: история, тренировка и план на {MEETING_MINUTES} минут.
          Этого достаточно, чтобы понять, подходит ли вам формат.
        </p>
        <p>
          Подписка открывает остальные {YEAR.lessons.length - FREE_LESSONS} встреч и все дни практики: {month.price} ₽
          за {SUBSCRIPTION_DAYS} дней. Оплата разовая, автоматического продления нет. Занятие, начатое до окончания
          срока, можно закончить.
        </p>
        <p className="muted small">
          Возврат — по заявлению, на ту же карту. Условия: <Link href="/legal/refund">возврат оплаты</Link>.
        </p>
      </section>

      <section className="offer-card">
        <h2>Чего здесь нет</h2>
        <p>
          Нет оценок ребёнка, уровней и «процентов развития». Нет обещаний роста оценок или IQ. Нет медицинских
          процедур и диагностики. Отчёт взрослому описывает, что было на занятиях, и не делает вывода о ребёнке.
        </p>
      </section>

      <p className="offer-links">
        <Link className="btn" href="/">Начать</Link>{' '}
        <Link className="btn secondary" href="/parent">Кабинет и подписка</Link>{' '}
        <Link className="btn secondary" href="/teacher">Кабинет педагога</Link>{' '}
        <Link className="btn ghost" href="/school">Для школы</Link>{' '}
        <Link className="btn ghost" href="/legal/terms">Условия</Link>
      </p>
      <p className="muted small">
        Документы: <Link href="/legal/privacy">обработка данных</Link>, <Link href="/legal/terms">оферта</Link>,{' '}
        <Link href="/legal/refund">возврат</Link>. Цена в оферте и в тарифе — одна и та же цифра: {OFFER_FACTS.priceRub} ₽.
      </p>
    </main>
  );
}
