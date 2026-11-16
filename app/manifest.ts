import type { MetadataRoute } from 'next';

/**
 * Веб-манифест PWA (`/manifest.webmanifest`).
 * Позволяет закрепить «Город историй» на домашнем экране планшета или телефона
 * в классе и быстро открывать закешированные шрифты и 3D-иллюстрации при слабой сети.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Город историй — тренажёр и годовая программа',
    short_name: 'Город историй',
    description: 'Истории, упражнения без оценок и годовая программа встреч для детей 5–13 лет',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'ru',
    background_color: '#fdf4e9',
    theme_color: '#fdf4e9',
    icons: [
      {
        src: '/art/v2/creatures/lis-face.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/art/v2/creatures/mira-face.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
