import type { Metadata, Viewport } from 'next';
import './globals.css';
import ReadingSettings from '@/components/ReadingSettings';
import PwaRegistration from '@/components/PwaRegistration';

export const metadata: Metadata = {
  title: 'Город историй — тренажёр навыков',
  description: 'Когнитивные и мягкие навыки для детей 5–13: тренировки, сценарии и отчёт для родителя',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Город историй',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fdf4e9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preload" href="/fonts/opendyslexic-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/art/v2/creatures/lis-face.png" as="image" />
        <link rel="preload" href="/art/v2/creatures/mira-face.png" as="image" />
        <link rel="preload" href="/art/v2/creatures/tima-face.png" as="image" />
      </head>
      <body>
        <ReadingSettings />
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
