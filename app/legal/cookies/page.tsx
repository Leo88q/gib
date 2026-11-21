import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Куки — ГИБ',
  description: 'Какие cookie и локальные настройки использует сервис и почему рекламных кук здесь нет.',
};

/**
 * Страница «Куки».
 *
 * Список того, что реально хранит браузер: две cookie и четыре ключа
 * localStorage. Если в коде появится новая cookie, страница должна
 * измениться вместе с ним — как и политика обработки данных.
 */

const COOKIES = [
  {
    name: 'gib_session',
    purpose: 'Серверная сессия входа после обмена одноразового кода, Telegram/MAX или веб-подписи.',
    duration: 'до 30 дней',
    required: 'да — без неё невозможен вход',
  },
  {
    name: 'gib_parent_gate',
    purpose: 'Подтверждение, что родитель ввёл PIN, — чтобы ребёнок не открыл настройки и магазин родителя.',
    duration: 'короткое время (сессия подтверждения)',
    required: 'да — защита родительской зоны',
  },
] as const;

const STORAGE = [
  { name: 'gib:muted', purpose: 'Беззвучный режим интерфейса («Без звука»).' },
  { name: 'gib:profileId', purpose: 'Выбранный профиль ребёнка на этом устройстве, чтобы не выбирать его каждый раз.' },
  { name: 'gib:receiptEmail', purpose: 'Почта для чека, подставляется в форму оплаты и может быть стёрта в любой момент.' },
  { name: 'gib:cookie-notice-v1', purpose: 'Отметка, что уведомление о куках прочитано.' },
] as const;

export default function CookiesPage() {
  return (
    <main className="page legal-page legal-document">
      <p className="muted small"><Link href="/legal">← Все документы</Link></p>
      <h1>Куки и локальное хранение</h1>
      <p className="muted">
        Здесь перечислено всё, что сервис сохраняет на устройстве. Рекламных, аналитических и
        маркетинговых cookie нет: их нельзя включить настройкой, потому что их нет в коде.
      </p>

      <section className="legal-section">
        <h2>Необходимые cookie</h2>
        <ul>
          {COOKIES.map((cookie) => (
            <li key={cookie.name}>
              <strong>{cookie.name}</strong> — {cookie.purpose} Хранятся: {cookie.duration}; {cookie.required}.
            </li>
          ))}
        </ul>
      </section>

      <section className="legal-section">
        <h2>Настройки в локальном хранилище (localStorage)</h2>
        <ul>
          {STORAGE.map((item) => (
            <li key={item.name}><strong>{item.name}</strong> — {item.purpose}</li>
          ))}
        </ul>
        <p className="muted small">
          localStorage не отправляется на сервер сам по себе: значения читаются только этим сайтом
          в вашем браузере. Очистка данных сайта в браузере удаляет их полностью.
        </p>
      </section>

      <section className="legal-section">
        <h2>Чего нет</h2>
        <ul>
          <li>нет аналитических cookie и сторонних счётчиков (пикселей) на страницах;</li>
          <li>нет рекламных идентификаторов и ремаркетинга;</li>
          <li>нет cookie социальных сетей и кнопок «поделиться»;</li>
          <li>нет fingerprinting и привязки к другим сайтам.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Как отказаться</h2>
        <p>
          Необходимые cookie отключить в браузере нельзя — без них не работает вход и защита
          родительской зоны. Всё остальное удаляется очисткой данных сайта; удаление профиля
          в кабинете удаляет и серверные данные ребёнка.
        </p>
      </section>

      <p><Link href="/legal">← Все документы</Link></p>
    </main>
  );
}
