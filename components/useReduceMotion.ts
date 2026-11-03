'use client';

import { useEffect, useState } from 'react';
import { readReadingPreferences, shouldReduceMotion, READING_EVENT, READING_KEY, type ReadingPreferences } from '@/lib/reading-preferences';

/**
 * «Меньше движения» учитывает и настройку игры, и системную настройку.
 * Возвращает false при первом рендере и обновляется после монтирования,
 * чтобы серверный и клиентский рендер совпадали.
 */
export default function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let preference = readReadingPreferences().reduceMotion;
    const update = () => setReduce(shouldReduceMotion(preference, Boolean(media?.matches)));
    const changed = (event: Event) => {
      preference = (event as CustomEvent<ReadingPreferences | undefined>).detail?.reduceMotion === true;
      update();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === READING_KEY || event.key === null) {
        preference = readReadingPreferences().reduceMotion;
        update();
      }
    };
    update();
    window.addEventListener(READING_EVENT, changed);
    window.addEventListener('storage', storage);
    media?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener(READING_EVENT, changed);
      window.removeEventListener('storage', storage);
      media?.removeEventListener?.('change', update);
    };
  }, []);
  return reduce;
}
