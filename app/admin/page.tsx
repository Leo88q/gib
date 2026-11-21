import type { Metadata } from 'next';
import AdminDashboard from '@/components/AdminDashboard';

export const metadata: Metadata = {
  title: 'Управление и исследование — ГИБ',
  description: 'Закрытая сводка показателей, выгрузка обезличенных таблиц и двойное кодирование показов.',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
