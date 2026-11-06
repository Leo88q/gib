'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type Goal = { confirmed: number; target: number; members: number; reached: boolean; notice: string };
type Limits = { min: number; max: number; step: number };

/**
 * Общая цель семьи в кабинете.
 *
 * Показывает одно число на всю семью: сколько подтверждённых отметок вместе и
 * сколько осталось. Без имён, без разбивки по детям и без сравнения — иначе
 * вклад одного ребёнка становился бы видимым другому и превращался в рейтинг.
 * Размер цели взрослый может изменить: цель — договорённость, а не норматив.
 */
export default function FamilyGoal({ profileId }: { profileId: string }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [limits, setLimits] = useState<Limits>({ min: 4, max: 60, step: 4 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch(`/api/family-goal?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        if (controller.signal.aborted) return;
        setGoal(data.goal); if (data.limits) setLimits(data.limits);
      } catch { if (!controller.signal.aborted) setError('Не удалось загрузить семейную цель.'); }
    })();
    return () => controller.abort();
  }, [profileId]);

  const change = async (target: number) => {
    if (busy || !goal || target === goal.target) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await apiFetch('/api/family-goal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('save_failed');
      setGoal(data.goal);
      setNotice(`Цель — ${data.goal.target} отметок. Это договорённость, её можно менять.`);
    } catch { setError('Не удалось сохранить размер цели. Попробуйте снова.'); }
    finally { setBusy(false); }
  };

  if (!goal && !error) return <section className="panel family-goal-panel" aria-label="Общая цель семьи"><p role="status">Загружаем семейную цель…</p></section>;

  const size = goal ? Math.min(100, Math.round((goal.confirmed / goal.target) * 100)) : 0;
  const sizes: number[] = [];
  if (goal) for (let v = limits.min; v <= limits.max; v += limits.step) sizes.push(v);

  return <section className="panel family-goal-panel" aria-label="Общая цель семьи">
    <h2>🌳 Общая цель семьи</h2>
    {error && <p role="alert" className="request-error">{error}</p>}
    {goal && <>
      <p className="muted">{goal.notice}</p>
      <div className="family-goal-bar" role="img" aria-label={`Общая цель: ${goal.confirmed} из ${goal.target}`}>
        <span style={{ width: `${size}%` }} />
      </div>
      <p className="muted small">
        {goal.members > 1
          ? 'Отметки всех детей складываются в одно число. Кто сколько внёс — не показывается: это не соревнование.'
          : 'Пока в цели один ребёнок. Когда детей больше, их отметки складываются в одно общее число.'}
      </p>
      <label htmlFor="family-goal-size">Сколько совместных отметок хотим</label>
      <select
        id="family-goal-size"
        value={goal.target}
        disabled={busy}
        onChange={e => void change(Number(e.target.value))}
      >
        {sizes.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      {notice && <p role="status" className="muted small">{notice}</p>}
      <p className="muted small">Цель не влияет на доступ к занятиям и не отнимает награды. Если не хочется — можно не стремиться к числу.</p>
    </>}
  </section>;
}
