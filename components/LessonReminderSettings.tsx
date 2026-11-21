'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type ReminderView = {
  reminder: { enabled: boolean; lastRemindedLesson: number | null; lastRemindedAt: number | null };
  hasSchedule: boolean;
  upcoming: { lesson: number; date: string; title: string; isShowcase: boolean } | null;
};

export default function LessonReminderSettings({ profileId }: { profileId: string }) {
  const [data, setData] = useState<ReminderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    apiFetch(`/api/lesson-reminders?profileId=${encodeURIComponent(profileId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load_failed'))))
      .then((json: ReminderView) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить настройку напоминаний о встречах.');
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function toggle(nextEnabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/lesson-reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, enabled: nextEnabled }),
      });
      if (!res.ok) {
        setError('Не удалось сохранить настройку напоминаний.');
        return;
      }
      const json = (await res.json()) as { reminder: ReminderView['reminder'] };
      setData((prev) => (prev ? { ...prev, reminder: json.reminder } : prev));
    } catch {
      setError('Не удалось сохранить настройку напоминаний.');
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(data?.reminder.enabled);

  return (
    <section className="card stack" aria-label="Напоминания об очных встречах">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Напоминание за день до встречи</h3>
          <p className="muted small" style={{ marginTop: 4 }}>
            Приходит только взрослому за сутки до даты в календаре занятий (Telegram, MAX или почта). Ребёнку уведомления не отправляются.
          </p>
        </div>
        <button
          type="button"
          className={enabled ? 'secondary' : 'primary'}
          aria-pressed={enabled}
          disabled={busy || !data}
          onClick={() => toggle(!enabled)}
        >
          {enabled ? 'Включено · выключить' : 'Включить напоминание'}
        </button>
      </div>
      {data && !data.hasSchedule && (
        <p className="muted small">
          Чтобы напоминания срабатывали по датам, выберите дату первой встречи в календаре занятий выше.
        </p>
      )}
      {data?.upcoming && enabled && (
        <p className="small">
          Ближайшее напоминание: встреча {data.upcoming.lesson} («{data.upcoming.title}») на {data.upcoming.date}.
        </p>
      )}
      {error && <p className="muted small" role="alert">{error}</p>}
    </section>
  );
}
