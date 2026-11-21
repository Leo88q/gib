import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL_DOCUMENTS, legalDocument, legalMissing, legalReady, resolveOperator } from '@/lib/legal/documents';

/**
 * Страница одного документа.
 *
 * `generateStaticParams` отдаёт ровно четыре известных документа: адрес
 * `/legal/что-угодно` должен давать 404, а не пустую страницу с датой, которую
 * потом кто-нибудь примет за действующую редакцию.
 */
export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((document) => ({ doc: document.id }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  const document = legalDocument(doc as never);
  return { title: document ? `${document.title} — ГИБ` : 'Документ не найден', description: document?.summary };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const document = legalDocument(doc as never);
  if (!document) notFound();
  const operator = resolveOperator();
  const ready = legalReady(operator);
  return (
    <main className="page legal-page legal-document">
      <p className="muted small"><Link href="/legal">← Все документы</Link></p>
      <h1>{document.title}</h1>
      <p className="muted">
        Редакция {document.version}. {document.summary}
      </p>
      {document.sections.map((section) => (
        <section key={section.heading} className="legal-section">
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <section className="legal-operator">
        <h2>Реквизиты оператора</h2>
        {ready ? (
          <>
            <p>{operator.name}</p>
            <p className="muted small">{operator.registration} · {operator.address}</p>
            <p className="muted small">{operator.email}</p>
          </>
        ) : (
          <p role="status" className="muted">
            Не заполнено: {legalMissing(operator).join(', ')}. До заполнения документ не может считаться опубликованным
            в окончательном виде.
          </p>
        )}
      </section>
      <p className="muted small">
        Это описание работы приложения, а не заключение юриста. Перед запуском текст проверяет специалист
        по персональным данным.
      </p>
    </main>
  );
}
