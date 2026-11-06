'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type Status = { configured: boolean; locked: boolean; retryAfterMs: number; minLength: number; maxLength: number; attempts: number; lockMs: number };

/**
 * Настройка кода взрослого. Пока PIN не задан, кабинет открыт любому, кто
 * держит телефон, — здесь это прямо сказано.
 */
export default function ParentPinSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pin, setPin] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch('/api/parent-pin', { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (!controller.signal.aborted) setStatus(data);
      } catch { /* настройка необязательна */ }
    })();
    return () => controller.abort();
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setDone('');
    try {
      const res = await apiFetch('/api/parent-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', pin, ...(status?.configured ? { current } : {}) }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(previous => previous ? { ...previous, configured: true } : previous);
        setPin(''); setCurrent('');
        setDone('Код сохранён. Теперь кабинет открывается только по нему.');
        return;
      }
      setError(
        data.error === 'weak_pin' ? 'Такой код слишком простой: не подряд и не из одной цифры.'
          : data.error === 'current_invalid' ? 'Текущий код неверный.'
          : data.error === 'invalid_pin_format' ? 'Код — только цифры, 4–8 знаков.'
          : 'Не удалось сохранить код.',
      );
    } catch { setError('Не удалось сохранить код. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(''); setDone('');
    try {
      const res = await apiFetch('/api/parent-pin', { method: 'DELETE' });
      if (res.ok) { setStatus(previous => previous ? { ...previous, configured: false } : previous); setDone('Код удалён. Кабинет снова открывается без кода.'); }
      else setError('Не удалось удалить код.');
    } catch { setError('Не удалось удалить код. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  return <section className="panel parent-pin" aria-label="Код взрослого">
    <h2>🔒 Код взрослого</h2>
    {!status && <p role="status">Загружаем настройку…</p>}
    {status && <>
      <p className="muted">
        {status.configured
          ? 'Кабинет открывается по коду. Ребёнок не попадёт в отчёт и настройки случайно.'
          : 'Код пока не задан: кабинет открывается без него. Задайте код, чтобы ребёнок не попадал в кабинет сам.'}
      </p>
      {error && <p role="alert" className="request-error">{error}</p>}
      {done && <p role="status">{done}</p>}
      {status.configured && <>
        <label htmlFor="pin-current">Текущий код</label>
        <input id="pin-current" type="password" inputMode="numeric" autoComplete="off" maxLength={status.maxLength} value={current} onChange={e => setCurrent(e.target.value.replace(/\D/g, ''))} />
      </>}
      <label htmlFor="pin-new">{status.configured ? 'Новый код' : 'Код'}</label>
      <input id="pin-new" type="password" inputMode="numeric" autoComplete="off" maxLength={status.maxLength} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
      <p className="muted small">Только цифры, {status.minLength}–{status.maxLength} знаков. Подряд и одинаковые цифры не подойдут. После {status.attempts} неудачных попыток вход закроется на {Math.round(status.lockMs / 60000)} мин.</p>
      <div className="parent-pin-actions">
        <button type="button" className="btn" disabled={busy || pin.length < status.minLength || (status.configured && current.length < status.minLength)} onClick={() => void save()}>{busy ? 'Сохраняем…' : status.configured ? 'Сменить код' : 'Задать код'}</button>
        {status.configured && <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>Удалить код</button>}
      </div>
      <p className="muted small">Код защищает от случайного входа ребёнка, но не проверяет личность взрослого. Настоящие независимые роли появятся вместе с аккаунтами взрослых.</p>
    </>}
  </section>;
}
