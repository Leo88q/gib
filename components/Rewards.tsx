'use client';

import Confetti from './Confetti';

export type RewardBadge = { id: string; title: string; desc: string; glyph: string; tier: string };

/** Экран итогов: звёзды, опыт, монетки, новые значки. */
export default function Rewards({
  stars,
  xp,
  coins,
  comboBest,
  tasks,
  correct,
  newBadges,
  badges,
  levelUp,
  program,
  onDone,
  onReflect,
}: {
  stars: number;
  xp: number;
  coins: number;
  comboBest: number;
  tasks: number;
  correct: number;
  newBadges: string[];
  badges: RewardBadge[];
  levelUp: { level: number; title: string } | null;
  program: { week: number; totalDays: number; completedDays: number; weekTitle: string } | null;
  onDone: () => void;
  onReflect?: () => void;
}) {
  const unlocked = badges.filter((b) => newBadges.includes(b.id));
  return (
    <div className="rewards">
      <Confetti count={stars >= 3 ? 70 : 40} />
      <div className="panel reward-panel">
        <img src="/art/mascot-celebrate.png" alt="" className="reward-mascot" />
        <h2 className="reward-title">Миссия выполнена!</h2>

        <div className="stars-row">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`star${i < stars ? ' on' : ''}`} style={{ animationDelay: `${i * 220}ms` }}>
              ⭐
            </span>
          ))}
        </div>

        <div className="reward-numbers">
          <div className="reward-num xp">
            <b>+{xp}</b>
            <span>опыта</span>
          </div>
          <div className="reward-num coins">
            <b>+{coins}</b>
            <span>монеток</span>
          </div>
          <div className="reward-num tasks">
            <b>
              {correct}/{tasks}
            </b>
            <span>заданий</span>
          </div>
          {comboBest > 1 && (
            <div className="reward-num combo">
              <b>×{comboBest}</b>
              <span>серия</span>
            </div>
          )}
        </div>

        {levelUp && (
          <div className="levelup">
            🎉 <b>Новый уровень: {levelUp.level}</b> — «{levelUp.title}»!
          </div>
        )}

        {unlocked.length > 0 && (
          <div className="reward-badges">
            <h4>Новые значки</h4>
            <div className="reward-badges-row">
              {unlocked.map((b) => (
                <div key={b.id} className={`badge-card ${b.tier} on`}>
                  <div className="badge-medal">
                    <span>{b.glyph}</span>
                  </div>
                  <b>{b.title}</b>
                  <span className="muted">{b.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {program && (
          <p className="muted">
            Программа: неделя {program.week} «{program.weekTitle}», пройдено{' '}
            {program.completedDays} из {program.totalDays} дней.
          </p>
        )}

        {onReflect && <button type="button" className="btn ghost" onClick={onReflect}>💭 Подвести итог (необязательно)</button>}
        <button type="button" className="btn big" onClick={onDone}>
          Домой
        </button>
      </div>
    </div>
  );
}
