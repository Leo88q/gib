'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type ConsentView = {
  granted: boolean;
  version: string;
  updatedAt: number | null;
  revokedAt: number | null;
};

export default function VideoConsentControl({ profileId }: { profileId: string }) {
  const [view, setView] = useState<ConsentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    apiFetch(`/api/video-consent?profileId=${encodeURIComponent(profileId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('load_failed'))))
      .then((data: ConsentView) => {
        if (!cancelled) setView(data);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить статус согласия на съёмку показа.');
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function updateConsent(granted: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/video-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, granted }),
      });
      if (!res.ok) {
        setError('Не удалось сохранить решение по видеофиксации.');
        return;
      }
      const data = (await res.json()) as ConsentView;
      setView(data);
    } catch {
      setError('Не удалось сохранить решение по видеофиксации.');
    } finally {
      setBusy(false);
    }
  }

  const granted = Boolean(view?.granted);

  return (
    <section className="card stack" aria-label="Согласие на съёмку очного показа">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>Съёмка очного показа для исследования (отдельное согласие)</h3>
          <p className="muted small" style={{ marginTop: 4 }}>
            По умолчанию выключено. При включении запись показа используется только двумя независимыми оценщиками ВУЗа
            для проверки шкалы выхода (0 · 1 · 2), не публикуется и не влияет на участие ребёнка в занятиях.
            Отзыв согласия сразу удаляет связанные записи кодирования.
          </p>
        </div>
        <button
          type="button"
          className={granted ? 'secondary' : 'primary'}
          aria-pressed={granted}
          disabled={busy || !view}
          onClick={() => updateConsent(!granted)}
        >
          {granted ? 'Отозвать согласие' : 'Разрешить для исследования'}
        </button>
      </div>
      {view && (
        <p className="muted small">
          Статус: {granted ? `разрешено (редакция ${view.version})` : 'не разрешено — видеокодирование для профиля закрыто'}.
        </p>
      )}
      {error && <p className="muted small" role="alert">{error}</p>}
    </section>
  );
}
