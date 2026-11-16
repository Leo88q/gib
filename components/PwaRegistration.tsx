'use client';

import { useEffect } from 'react';

/**
 * Тихо регистрирует `public/sw.js` для предзагрузки и офлайн-кеша статики
 * (шрифты OpenDyslexic и 3D-арт v2) без кеширования API и персональных данных.
 */
export default function PwaRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* отсутствие SW не мешает работе приложения */
    });
  }, []);
  return null;
}
