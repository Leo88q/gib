'use client';

import { useEffect, useRef, useState } from 'react';
import ScenarioView, { type ScenarioVariantPublic } from './ScenarioView';
import {
  clipFor, loadCinemaManifest, type CinemaEntry,
} from '@/lib/cinema/manifest';
import type { AgeBand } from '@/lib/types';

/**
 * Обёртка над ScenarioView: перед обычной сценой — короткое ролик-вступление
 * (Ken Burns + голос). По окончании или по «Пропустить →» рендерится
 * обычный ScenarioView с той же логикой ответов. Если ролика нет, флаг
 * выключен или пользователь просит меньше движения — сразу ScenarioView.
 */
export default function CinemaStory(props: {
  scenario: { scenarioId: string; competency: string; skillLabel: string; variant: ScenarioVariantPublic };
  onAnswer: (answer: { index: number; cells?: number[] }) => Promise<void>;
  band: AgeBand;
  draftKey?: string;
}) {
  const { scenario, band } = props;
  const enabled = process.env.NEXT_PUBLIC_CINEMA_STORY === '1';
  const [clip, setClip] = useState<CinemaEntry | null | undefined>(enabled ? undefined : null);
  const [introDone, setIntroDone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const media = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (!media) return;
    setReducedMotion(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadCinemaManifest().then((manifest) => {
      if (cancelled) return;
      setClip(clipFor(manifest, scenario.scenarioId, band));
    });
    return () => { cancelled = true; };
  }, [enabled, scenario.scenarioId, band]);

  useEffect(() => {
    if (!clip || introDone) return;
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => setBlocked(true));
  }, [clip, introDone]);

  if (!enabled || reducedMotion || introDone || clip === null) {
    return <ScenarioView {...props} />;
  }

  if (clip === undefined) {
    // Манифест ещё грузится — показываем обычную сцену, не блокируя ребёнка.
    return <ScenarioView {...props} />;
  }

  if (blocked) {
    return (
      <div className="cinema-intro cinema-blocked" role="group" aria-label="Сцена-видео по желанию">
        <p className="cinema-blocked-text">Браузер заблокировал автовоспроизведение со звуком.</p>
        <button type="button" className="btn cinema-play" onClick={() => { setBlocked(false); void videoRef.current?.play().catch(() => setIntroDone(true)); }}>▶ Смотреть сцену</button>
        <button type="button" className="btn secondary cinema-skip-inline" onClick={() => setIntroDone(true)}>Пропустить →</button>
      </div>
    );
  }

  return (
    <div className="cinema-intro">
      <video
        ref={videoRef}
        className="cinema-video"
        src={clip.intro}
        poster={clip.poster}
        playsInline
        preload="metadata"
        aria-label="Видео-вступление к сцене"
        onEnded={() => setIntroDone(true)}
        onError={() => setIntroDone(true)}
      />
      <button type="button" className="cinema-skip" autoFocus onClick={() => setIntroDone(true)}>
        Пропустить →
      </button>
    </div>
  );
}
