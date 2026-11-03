'use client';

export type BadgeView = {
  id: string;
  title: string;
  desc: string;
  glyph: string;
  tier: 'bronze' | 'silver' | 'gold';
  unlocked: boolean;
};

/** Коллекция значков — «дневник достижений» ребёнка. */
export default function BadgeGrid({ badges }: { badges: BadgeView[] }) {
  const unlocked = badges.filter((b) => b.unlocked).length;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Значки</h3>
        <span className="muted">
          {unlocked} из {badges.length}
        </span>
      </div>
      <div className="badge-grid">
        {badges.map((b) => (
          <div key={b.id} className={`badge-card ${b.tier}${b.unlocked ? ' on' : ''}`}>
            <div className="badge-medal">
              <span>{b.unlocked ? b.glyph : '🔒'}</span>
            </div>
            <b>{b.title}</b>
            <span className="muted">{b.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
