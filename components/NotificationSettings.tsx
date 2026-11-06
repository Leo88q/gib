'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type Frequency = 'off' | 'weekly' | 'monthly';
type View = {
  settings: { enabled: boolean; frequency: Frequency; lastSentAt: number | null };
  labels: Record<Frequency, string>;
  canSendNow: boolean;
  reason: string | null;
  retryText: string;
  notice: string;
};

/**
 * Уведомления взрослому.
 *
 * По умолчанию выключены. Включаются только явным действием и имеют частоту —
 * чаще раза в неделю отчёт не уходит, даже если жать кнопку. Ребёнку сообщения
 * не отправляются вообще: это уведомление для взрослого.
 */
export default function NotificationSettings({ profileId }: { profileId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch(`/api/notifications?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('load_failed');
        const data = await res.json();
        if (!controller.signal.aborted) setView(data);
      } catch { if (!controller.signal.aborted) setError('Не удалось загрузить настройку уведомлений.'); }
    })();
    return () => controller.abort();
  }, [profileId]);

  const save = async (enabled: boolean, frequency: Frequency) => {
    if (busy || !view) return;
    setBusy(true); setError(''); setDone('');
    try {
      const res = await apiFetch('/api/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, enabled, frequency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('save_failed');
      setView(data);
      setDone(enabled ? 'Уведомления включены: это отдельное согласие, его можно отозвать здесь же.' : 'Уведомления выключены.');
    } catch { setError('Не удалось сохранить настройку. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  return <section className="panel notifications" aria-label="Уведомления взрослому">
    <h2>🔔 Уведомления взрослому</h2>
    {error && <p role="alert" className="request-error">{error}</p>}
    {!view && !error && <p role="status">Загружаем настройку…</p>}
    {view && <>
      <p className="muted">{view.notice}</p>
      <div className="notify-choice">
        <button
          type="button"
          className={`btn${view.settings.enabled ? '' : ' secondary'}`}
          aria-pressed={!view.settings.enabled}
          disabled={busy}
          onClick={() => void save(false, 'off')}
        >Не отправлять</button>
        <button
          type="button"
          className={`btn${view.settings.enabled && view.settings.frequency === 'weekly' ? '' : ' secondary'}`}
          aria-pressed={view.settings.enabled && view.settings.frequency === 'weekly'}
          disabled={busy}
          onClick={() => void save(true, 'weekly')}
        >{view.labels.weekly}</button>
        <button
          type="button"
          className={`btn${view.settings.enabled && view.settings.frequency === 'monthly' ? '' : ' secondary'}`}
          aria-pressed={view.settings.enabled && view.settings.frequency === 'monthly'}
          disabled={busy}
          onClick={() => void save(true, 'monthly')}
        >{view.labels.monthly}</button>
      </div>
      {done && <p role="status" className="muted small">{done}</p>}
      {view.settings.enabled && !view.canSendNow && view.retryText && (
        <p className="muted small">Следующий отчёт можно отправить через {view.retryText}.</p>
      )}
      <p className="muted small">
        Чаще раза в неделю отчёт не уходит: ограничение на сервере, а не только в тексте.
        Сообщения ребёнку мы не отправляем вовсе. Согласие на сохранение отметок чувств не считается согласием на уведомления.
      </p>
    </>}
  </section>;
}
