import type { Metadata, Viewport } from 'next';
import './globals.css';
import ReadingSettings from '@/components/ReadingSettings';

export const metadata: Metadata = {
  title: 'Тренажёр навыков',
  description: 'Когнитивные и мягкие навыки для детей 5–13: тренировки, сценарии и отчёт для родителя',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f6bff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body><ReadingSettings />{children}</body>
    </html>
  );
}
