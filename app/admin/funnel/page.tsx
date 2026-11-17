import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import FunnelReport from '@/components/FunnelReport.tsx';

/**
 * Служебный экран: воронка запуска.
 *
 * Страница ничего не отдаёт без токена и не индексируется: это рабочий
 * инструмент дежурного, а не раздел продукта. Данные приходят из
 * `/api/admin/funnel` — того же маршрута, что и раньше, поэтому числа на
 * экране и в JSON не могут разойтись.
 */
export const metadata: Metadata = {
  title: 'Воронка запуска — ГИБ',
  description: 'Служебный отчёт: где теряются взрослые на пути к оплате.',
  robots: { index: false, follow: false },
};

export default function AdminFunnelPage() {
  return (
    <main className="page funnel-page">
      <p className="muted small"><Link href="/admin">← Панель управления и исследования</Link></p>
      <h1>Воронка запуска</h1>
      <p className="muted">
        Шесть шагов от согласия до оплаты. Считаются уникальные взрослые, а не дети: платит взрослый.
        Идентификаторы и имена в отчёт не попадают.
      </p>
      <FunnelReport />
    </main>
  );
}
