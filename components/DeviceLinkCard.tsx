'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

/**
 * Карточка кабинета взрослого для открытия того же аккаунта на ноутбуке,
 * планшете или школьном компьютере по одноразовому 6-значному коду.
 */
export default function DeviceLinkCard() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await apiFetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_code' }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok || !data.code) {
        setMessage('Не удалось создать код. Проверьте соединение.');
        return;
      }
      setCode(data.code);
    } catch {
      setMessage('Не удалось создать код. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  };

  const logoutBrowser = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/auth/session', { method: 'DELETE' });
      setMessage('Браузерная сессия на этом устройстве завершена.');
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Вход на компьютере или планшете</h2>
      <p className="muted small">
        Чтобы открыть этот кабинет, распечатать план встречи на 40 минут или вести группу педагога в обычном браузере,
        выпустите одноразовый 6-значный код (действует 10 минут).
      </p>
      {code && (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            marginBottom: 10,
            borderRadius: 14,
            background: 'var(--gold-soft)',
            border: '1px solid var(--line)',
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: '0.2em',
            textAlign: 'center',
          }}
        >
          {code}
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void generate()}>
          {code ? 'Обновить код для браузера' : 'Выпустить код для браузера'}
        </button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => void logoutBrowser()}>
          Выйти из браузера
        </button>
      </div>
      {message && <p role="status" className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>{message}</p>}
    </div>
  );
}
