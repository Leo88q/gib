'use client';

import { useState } from 'react';
import Link from 'next/link';
import { heroFace } from '@/lib/art-paths';

export default function WebAuthPanel({
  title = 'Город историй',
  onAuthenticated,
}: {
  title?: string;
  onAuthenticated?: () => void;
}) {
  const [mode, setMode] = useState<'link' | 'email'>('link');
  const [linkCode, setLinkCode] = useState('');
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devPreview, setDevPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const complete = () => {
    if (onAuthenticated) onAuthenticated();
    else window.location.reload();
  };

  const redeemLink = async () => {
    if (busy || linkCode.replace(/\D/g, '').length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem_code', code: linkCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          data.error === 'invalid_or_expired_code'
            ? 'Код не подошёл или истёк. Запросите свежий код в кабинете или в чате с ботом (/link).'
            : 'Не удалось выполнить вход. Попробуйте ещё раз.',
        );
        return;
      }
      complete();
    } catch {
      setError('Не удалось связаться с сервером. Проверьте подключение.');
    } finally {
      setBusy(false);
    }
  };

  const requestOtp = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError('');
    setDevPreview('');
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_email_code', email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; previewCode?: string };
      if (!res.ok) {
        if (data.error === 'invalid_email') setError('Проверьте адрес электронной почты.');
        else if (data.error === 'email_not_configured') {
          setError('Отправка писем на этом сервере пока не подключена — войдите по 6-значному коду из Telegram или MAX.');
        } else {
          setError('Не удалось отправить код на почту. Попробуйте позже.');
        }
        return;
      }
      setOtpSent(true);
      if (data.previewCode) setDevPreview(data.previewCode);
    } catch {
      setError('Не удалось отправить запрос. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (busy || otpCode.replace(/\D/g, '').length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_email_code', email: email.trim(), code: otpCode }),
      });
      if (!res.ok) {
        setError('Код из письма неверный или уже истёк.');
        return;
      }
      complete();
    } catch {
      setError('Не удалось проверить код. Попробуйте снова.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <div className="panel onboarding" style={{ textAlign: 'left' }}>
        <img src="/art/v2/places/yard.png" alt="" className="hero-art" />
        <span className="chip">Годовая программа · 5–13 лет</span>
        <h1 style={{ marginTop: 10 }}>{title}</h1>
        <p className="muted">
          Интерактивный тренажёр и программа очных встреч: 36 занятий в году, 12 показов и 60 дней
          коротких историй и упражнений без оценок. Три возрастные линейки ведут свои проводники:
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0 16px' }}>
          {(
            [
              ['5-7', 'Лис · 5–7 лет'],
              ['8-10', 'Мира · 8–10 лет'],
              ['11-13', 'Тима · 11–13 лет'],
            ] as const
          ).map(([band, label]) => (
            <span key={band} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <img src={heroFace(band)} alt="" width={26} height={26} style={{ borderRadius: '50%' }} />
              {label}
            </span>
          ))}
        </div>

        <div className="choice-list compact" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`choice${mode === 'link' ? ' active' : ''}`}
            aria-pressed={mode === 'link'}
            onClick={() => { setMode('link'); setError(''); }}
          >
            <strong>Войти по коду из Telegram или MAX</strong>
            <span className="muted small">Откройте свой профиль семьи или группу педагога на компьютере или планшете.</span>
          </button>
          <button
            type="button"
            className={`choice${mode === 'email' ? ' active' : ''}`}
            aria-pressed={mode === 'email'}
            onClick={() => { setMode('email'); setError(''); }}
          >
            <strong>Войти по электронной почте</strong>
            <span className="muted small">Самостоятельный вход в браузере по одноразовому коду без мессенджера.</span>
          </button>
        </div>

        {mode === 'link' ? (
          <div>
            <p className="muted small">
              Отправьте боту команду <code>/link</code> в Telegram или MAX (или нажмите «Код для браузера» в кабинете на телефоне)
              и введите 6 цифр ниже:
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={7}
                placeholder="6 цифр кода"
                value={linkCode}
                onChange={(e) => setLinkCode(e.target.value.replace(/[^\d\s-]/g, ''))}
                aria-label="Шестизначный код привязки"
                style={{ flex: '1 1 180px', letterSpacing: '0.18em', textAlign: 'center', fontWeight: 800 }}
              />
              <button
                type="button"
                className="btn"
                disabled={busy || linkCode.replace(/\D/g, '').length !== 6}
                onClick={() => void redeemLink()}
              >
                {busy ? 'Проверяем…' : 'Открыть аккаунт'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="web-auth-email" className="small" style={{ fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Электронная почта взрослого
            </label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                id="web-auth-email"
                type="email"
                placeholder="parent@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                style={{ flex: '1 1 220px' }}
              />
              <button type="button" className="btn secondary" disabled={busy || !email.trim()} onClick={() => void requestOtp()}>
                {otpSent ? 'Отправить снова' : 'Получить код'}
              </button>
            </div>

            {devPreview && (
              <p className="muted small" role="status" style={{ marginTop: 8 }}>
                Локальный режим разработки — ваш код: <strong>{devPreview}</strong>
              </p>
            )}

            {otpSent && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={7}
                  placeholder="Код из письма (6 цифр)"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^\d\s-]/g, ''))}
                  aria-label="Код из письма"
                  style={{ flex: '1 1 180px', letterSpacing: '0.18em', textAlign: 'center', fontWeight: 800 }}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || otpCode.replace(/\D/g, '').length !== 6}
                  onClick={() => void verifyOtp()}
                >
                  Войти
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" style={{ color: 'var(--bad)', marginTop: 10 }}>{error}</p>}

        <p className="muted small" style={{ marginTop: 16, marginBottom: 0 }}>
          Подробнее до входа: <Link href="/offer">что входит и сколько стоит</Link> ·{' '}
          <Link href="/school">сводка для школы (ФГОС)</Link> · <Link href="/legal">документы и возврат</Link>
        </p>
      </div>
    </div>
  );
}
