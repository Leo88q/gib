'use client';

import { useEffect, useRef } from 'react';
import { journeyResumeKey, journeySignature, parseJourneyResume, type JourneyResume } from '@/lib/day/journey-draft';

/**
 * Помнит только место остановки, не ответы.
 *
 * `signature` — профиль и день; меняется, значит старый черновик не подходит.
 * Запись удаляется, когда экран пройден, и при явном `clear`.
 */
export default function useJourneyResume({
  profileId,
  day,
  screen,
  phase,
  enabled = true,
}: {
  profileId?: string;
  day?: number;
  screen: 'welcome' | 'reflection';
  phase?: 'checkin' | 'pause';
  enabled?: boolean;
}): { resume: JourneyResume | null; restored: boolean; clear: () => void } {
  const key = profileId && Number.isInteger(day) ? journeyResumeKey(profileId, day as number) : null;
  const signature = profileId && Number.isInteger(day) ? journeySignature(profileId, day as number) : null;
  const resume = key && signature ? (() => { try { return parseJourneyResume(sessionStorage.getItem(key), signature); } catch { return null; } })() : null;
  // Фиксируем факт восстановления один раз за монтирование: дальше эффект сам пишет черновик.
  const initiallyFound = useRef(Boolean(resume && resume.screen === screen));

  useEffect(() => {
    if (!enabled || !key || !signature) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(screen === 'welcome'
        ? { version: 1, signature, screen, phase: phase ?? 'checkin' }
        : { version: 1, signature, screen }));
    } catch { /* возобновление необязательно */ }
  }, [enabled, key, signature, screen, phase]);

  return {
    resume: resume && resume.screen === screen ? resume : null,
    // true, если после перезагрузки мы действительно вернулись на этот экран
    restored: Boolean(initiallyFound.current && resume && resume.screen === screen),
    clear: () => { if (key) { try { sessionStorage.removeItem(key); } catch { /* storage may be disabled */ } } },
  };
}

/** Удаляет черновики возобновления профиля (например, при удалении профиля). */
export function removeProfileJourneyResumes(storage: Storage, profileId: string) {
  const prefix = `gib:journey-resume:v1:${profileId}:`;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch { /* storage may be disabled */ }
}
