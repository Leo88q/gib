'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type View = { enabled: boolean; retentionDays: number; limit: number; checkins: { id: string; day: string; feelings: string[] }[] };
const LABELS: Record<string, string> = { joy: 'радость', calm: 'спокойствие', sad: 'грусть', anger: 'злость', fear: 'страх', unsure: 'пока не знаю' };

/**
 * Согласие взрослого на сохранение отметок чувств.
 * По умолчанию сохранения нет; отзыв согласия стирает уже сохранённое.
 */
export default function FeelingsConsent({ profileId }: { profileId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const res = await apiFetch(`/api/feelings?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw Error('load');
        const data = await res.json();
        if (!controller.signal.aborted) setView(data);
      } catch { if (!controller.signal.aborted) setError('Не удалось загрузить настройку.'); }
    })();
    return () => controller.abort();
  }, [profileId, reload]);

  const setConsent = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/api/feelings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, action: 'consent', enabled }) });
      const data = await res.json();
      if (!res.ok) throw Error('save');
      setView(data);
    } catch { setError('Не удалось сохранить настройку. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  const removeAll = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`/api/feelings?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw Error('delete');
      setView(data);
    } catch { setError('Не удалось удалить отметки. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  return <section className="panel feelings-consent" aria-label="Отметки чувств">
    <h2>💬 Отметки чувств</h2>
    <p className="muted">Ребёнок может отметить, как он себя чувствует, перед миссией. Это всегда необязательно. По умолчанию отметки <b>не сохраняются</b>, а если сохраняются — <b>не попадают в отчёт по активности</b>, в награды и в журнал событий.</p>
    {error && <div role="alert" className="request-error">{error}</div>}
    {!view && !error && <p role="status">Загружаем настройку…</p>}
    {view && <>
      <p><b>Сохранение:</b> {view.enabled ? 'включено' : 'выключено'}</p>
      <p className="muted small">
        {view.enabled
          ? `Отметки хранятся до ${view.retentionDays} дней, не больше ${view.limit}. Они не влияют на награды и не попадают в отчёт по активности. Если согласие отозвать, сохранённое удаляется.`
          : 'Без согласия взрослого отметки живут только в памяти экрана и никуда не отправляются.'}
      </p>
      <div className="feelings-consent-actions">
        <button type="button" className="btn" disabled={busy || view.enabled} onClick={() => void setConsent(true)}>Разрешить сохранение</button>
        <button type="button" className="btn ghost" disabled={busy || !view.enabled} onClick={() => void setConsent(false)}>Отозвать согласие</button>
        {view.checkins.length > 0 && <button type="button" className="btn ghost" disabled={busy} onClick={() => void removeAll()}>Удалить все отметки</button>}
      </div>
      {view.enabled && <div>
        <h3>Сохранённые отметки</h3>
        {view.checkins.length === 0
          ? <p className="muted">Пока ничего не сохранено.</p>
          : <ul className="feelings-list">{view.checkins.map(item => <li key={item.id}>{item.day}: {item.feelings.map(f => LABELS[f] ?? f).join(', ')}</li>)}</ul>}
        <p className="muted small">Здесь только то, что ребёнок отметил сам. Отметки не показывают причин и не заменяют разговор. Если что-то тревожит — поговорите с ребёнком; при необходимости обратитесь к специалисту.</p>
      </div>}
      <p className="muted small">Сроки хранения и доступ родителей к содержимому должен подтвердить профильный юрист. До этого реальные отметки детей сохранять нельзя — только демонстрационные данные.</p>
    </>}
  </section>;
}
