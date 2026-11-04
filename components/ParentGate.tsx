'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type Status = { configured: boolean; locked: boolean; retryAfterMs: number; minLength: number; maxLength: number; attempts: number; lockMs: number; sessionMs: number };

const SESSION_KEY = 'gib:parentUnlockedUntil';

function sessionValid(): boolean {
  try {
    const until = Number(localStorage.getItem(SESSION_KEY) ?? 0);
    return Number.isFinite(until) && until > Date.now();
  } catch { return false; }
}

/**
 * Ворота кабинета: если взрослый задал PIN, вход требует его.
 *
 * Без PIN кабинет открыт как раньше — это обратная совместимость и демо.
 * PIN не заменяет настоящую аутентификацию: он защищает от случайного входа
 * ребёнка на телефоне, который лежит рядом.
 */
export default function ParentGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setUnlocked(sessionValid());
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch('/api/parent-pin', { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (!controller.signal.aborted) setStatus(data);
      } catch { /* без PIN-сервиса кабинет работает как раньше */ }
    })();
    return () => controller.abort();
  }, []);

  // Обратный отсчёт блокировки: без него человек не понимает, сколько ждать.
  useEffect(() => {
    if (!status?.locked) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status?.locked]);

  if (unlocked || (status !== null && !status.configured)) return <>{children}</>;
  if (!status) return <div className="wrap"><div className="card" role="status">Проверяем доступ…</div></div>;

  const lockedFor = status.locked ? Math.max(0, Math.ceil((status.retryAfterMs - (Date.now() - now)) / 1000)) : 0;

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/api/parent-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin }) });
      const data = await res.json();
      if (res.ok && data.ok) {
        const until = Date.now() + (data.sessionMs ?? status.sessionMs ?? 0);
        try { localStorage.setItem(SESSION_KEY, String(until)); } catch { /* storage is optional */ }
        setUnlocked(true);
        setPin('');
        return;
      }
      if (data.error === 'pin_locked') setError('Слишком много попыток. Подождите несколько минут.');
      else setError('Неверный код. Попробуйте ещё раз.');
      setPin('');
    } catch { setError('Не удалось проверить код. Проверьте соединение.'); }
    finally { setBusy(false); }
  };

  return <div className="wrap">
    <div className="card parent-gate">
      <h1>Кабинет родителя</h1>
      <p>Этот раздел — для взрослого. Введите код, который вы задали.</p>
      {lockedFor > 0 ? <p role="alert" className="request-error">Вход временно закрыт. Подождите {lockedFor} с.</p> : <>
        <label htmlFor="parent-pin">Код</label>
        <input
          id="parent-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={status.maxLength}
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
        />
        {error && <p role="alert" className="request-error">{error}</p>}
        <button type="button" className="btn" disabled={busy || pin.length < status.minLength} onClick={() => void submit()}>{busy ? 'Проверяем…' : 'Открыть кабинет'}</button>
      </>}
      <p className="muted small">Код защищает от случайного входа ребёнка. Это не проверка личности: телефон с открытым приложением остаётся доступным тому, кто его держит.</p>
    </div>
  </div>;
}
