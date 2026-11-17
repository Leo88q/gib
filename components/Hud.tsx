'use client';

import { useEffect, useState } from 'react';
import { isMuted, onMuteChange, setMuted, sfx } from '@/lib/sound';

export type HudData = {
  level: number;
  levelTitle: string;
  xp: number;
  xpPercent: number;
  coins: number;
  stars: number;
  combo?: number;
};

/** Верхняя панель игрока: уровень, опыт, монетки, звёзды и явный режим «Без звука». */
export default function Hud({ data, compact = false }: { data: HudData; compact?: boolean }) {
  const [muted, setMutedState] = useState(() => isMuted());

  useEffect(() => onMuteChange(setMutedState), []);

  return (
    <div className={`hud${compact ? ' compact' : ''}`}>
      <div className="hud-level">
        <span className="hud-level-num">{data.level}</span>
        <div className="hud-level-text">
          <b>{data.levelTitle}</b>
          <div className="xp-bar">
            <span style={{ width: `${data.xpPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="hud-stats">
        {data.combo && data.combo > 1 && <span className="chip combo">⚡ {data.combo}</span>}
        <span className="chip coins">🪙 {data.coins}</span>
        <span className="chip stars">⭐ {data.stars}</span>
      </div>

      <button
        type="button"
        className={`hud-sound${muted ? ' muted' : ''}`}
        aria-pressed={muted}
        aria-label={muted ? 'Режим «Без звука» включён — нажмите, чтобы включить звук' : 'Включить режим «Без звука»'}
        title={muted ? 'Включить звук' : 'Режим «Без звука»'}
        onClick={() => {
          const next = !muted;
          setMuted(next);
          setMutedState(next);
          if (!next) sfx.tap();
        }}
      >
        <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
        {!compact && <span className="hud-sound-label">{muted ? 'Без звука' : 'Звук'}</span>}
      </button>
    </div>
  );
}
