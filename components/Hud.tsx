'use client';

import { isMuted, setMuted, sfx } from '@/lib/sound';

export type HudData = {
  level: number;
  levelTitle: string;
  xp: number;
  xpPercent: number;
  coins: number;
  stars: number;
  combo?: number;
};

/** Верхняя панель игрока: уровень, опыт, монетки и звёзды. */
export default function Hud({ data, compact = false }: { data: HudData; compact?: boolean }) {
  const muted = isMuted();
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
        className="hud-sound"
        title={muted ? 'Включить звук' : 'Выключить звук'}
        onClick={() => {
          setMuted(!muted);
          if (!muted) sfx.tap();
        }}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}
