'use client';

export type MissionView = {
  id: string;
  title: string;
  desc: string;
  glyph: string;
  target: number;
  progress: number;
  done: boolean;
  claimed: boolean;
};

/** Ежедневные миссии — то, ради чего ребёнок возвращается завтра. */
export default function Missions({
  missions,
  onClaim,
}: {
  missions: MissionView[];
  onClaim: (id: string) => void;
}) {
  if (!missions.length) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Миссии дня</h3>
        <span className="muted">забрать награду можно один раз</span>
      </div>
      <div className="missions">
        {missions.map((m) => (
          <div key={m.id} className={`mission${m.done ? ' done' : ''}${m.claimed ? ' claimed' : ''}`}>
            <span className="mission-glyph">{m.glyph}</span>
            <div className="mission-body">
              <div className="mission-title">
                <b>{m.title}</b>
                <span className="muted">
                  {Math.min(m.progress, m.target)}/{m.target}
                </span>
              </div>
              <div className="mission-desc">{m.desc}</div>
              <div className="mission-bar">
                <span style={{ width: `${Math.min(100, (m.progress / m.target) * 100)}%` }} />
              </div>
            </div>
            {m.done && !m.claimed ? (
              <button
                type="button"
                className="btn tiny"
                onClick={() => onClaim(m.id)}
              >
                🪙 Забрать
              </button>
            ) : (
              <span className="mission-check">{m.claimed ? '✔' : m.done ? '!' : ''}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
