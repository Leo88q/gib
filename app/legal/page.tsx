import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { LEGAL_DOCUMENTS, legalMissing, legalReady, resolveOperator } from '@/lib/legal/documents';

export const metadata: Metadata = {
  title: 'Документы — ГИБ',
  description: 'Политика обработки данных, оферта, возврат оплаты и согласие законного представителя.',
};

/**
 * Оглавление документов.
 *
 * Одна страница со списком, а не меню: взрослому нужно увидеть сразу, что
 * документы есть и сколько их. Незаполненные реквизиты показаны честно —
 * блоком «чего не хватает», а не пустым местом, которое читается как согласие.
 */
export default function LegalIndexPage() {
  const operator = resolveOperator();
  const ready = legalReady(operator);
  return (
    <main className="page legal-page">
      <h1>Документы</h1>
      <p className="muted">
        Здесь то, что взрослый подтверждает перед первым занятием ребёнка, и то, на каких условиях берётся оплата.
        Версии указаны датой: согласие даётся на конкретную редакцию и хранится вместе с ней.
      </p>
      <ul className="legal-list">
        {LEGAL_DOCUMENTS.map((document) => (
          <li key={document.id} className="legal-list-item">
            <Link href={`/legal/${document.id}`}>{document.title}</Link>
            <p className="muted small">{document.summary}</p>
            <p className="muted small">Редакция от {new Date(document.version).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </li>
        ))}
      </ul>
      <section className="legal-operator">
        <h2>Кто отвечает за данные</h2>
        {ready ? (
          <>
            <p>{operator.name}</p>
            <p className="muted small">{operator.registration}</p>
            <p className="muted small">{operator.address}</p>
            <p className="muted small">{operator.email}</p>
          </>
        ) : (
          <>
            <p role="status">
              Реквизиты оператора пока не заполнены. Документы опубликованы, но пока не называют того, кто отвечает
              за обработку данных, — значит, и согласие по ним давать рано.
            </p>
            <ul className="muted small">
              {legalMissing(operator).map((item) => <li key={item}>не заполнено: {item}</li>)}
            </ul>
          </>
        )}
      </section>
      <p className="muted small">
        Документы описывают то, что делает приложение. Они не заменяют проверку юристом: перед публикацией текст
        должен прочитать специалист по персональным данным.
      </p>
      <p><Link href="/">← На главную</Link></p>
    </main>
  );
}
