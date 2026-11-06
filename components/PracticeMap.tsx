'use client';
import { useEffect, useState } from 'react';
import type { PracticeTopic } from '@/lib/engine/practice-map';
import type { ActivityDay } from '@/lib/engine/activity-history';
import { competencyArt, DEFAULT_ART } from '@/lib/art-paths';
import { apiFetch } from '@/lib/telegramClient';

/** Only displays aggregate game participation, never scores or answers. */
export default function PracticeMap({ profileId }: { profileId: string }) {
  const [topics, setTopics] = useState<PracticeTopic[] | null>(null);
  const [activity, setActivity] = useState<{ days: ActivityDay[]; activeDays: number; totalDays: number; text: string } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false); setTopics(null);
    void (async () => {
      try {
        const res = await apiFetch(`/api/practice-map?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw Error('map_failed');
        const data = await res.json();
        if (!Array.isArray(data.topics)) throw Error('map_failed');
        if (!controller.signal.aborted) { setTopics(data.topics); setActivity(data.activity ?? null); }
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => controller.abort();
  }, [profileId, retry]);
  return <section className="panel practice-map" aria-label="Карта практики">
    <h2>🗺️ Карта практики</h2>
    <p>Здесь отмечены темы завершённых историй и упражнений. Это не оценка тебя или твоих качеств. Повторы тоже учитываются.</p>
    {error ? <p role="alert">Не удалось загрузить карту. <button className="btn ghost" type="button" onClick={() => setRetry(n => n + 1)}>Попробовать ещё</button></p> : !topics ? <p role="status">Загружаем карту…</p> : <div className="practice-map-grid">
      {topics.map(topic => <article className="practice-map-topic" key={topic.id}>
        <img src={competencyArt(topic.id)} alt="" onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_ART)) e.currentTarget.src = DEFAULT_ART; }} />
        <div><h3>{topic.title}</h3>{topic.stories ? <p>Историй завершено: {topic.stories}{topic.practices > 0 && <> · практик поддержки: {topic.practices}</>}</p> : <p>Пока не встречалась</p>}</div>
      </article>)}
    </div>}
    {activity && (
      <div className="activity-strip">
        <h3>Дни занятий</h3>
        <p>{activity.text}</p>
        <ol className="activity-days" aria-label="Занятия за последние 28 дней">
          {activity.days.map(day => (
            <li
              key={day.day}
              className={`activity-day${day.sessions > 0 ? ' on' : ''}${day.reviewOnly ? ' review' : ''}`}
              // Точный день и число занятий доступны диктору; «пропуск» не называем.
              title={day.sessions > 0 ? `${day.day}: занятий ${day.sessions}` : `${day.day}: занятий не было`}
            >
              <span aria-hidden="true">{day.sessions > 0 ? (day.reviewOnly ? '🔁' : '•') : ''}</span>
              <span className="sr-only">{day.sessions > 0 ? `${day.day}: занятий ${day.sessions}` : `${day.day}: занятий не было`}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">Пустой день — это просто день без занятия. Ничего за это не отнимается.</p>
      </div>
    )}
    <p className="muted">Карта не показывает ответы, чувства, оценки или рекомендации.</p>
  </section>;
}
