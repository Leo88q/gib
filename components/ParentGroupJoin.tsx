'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/telegramClient';

type JoinedGroup = {
  groupId: string;
  name: string;
  year: number;
  joinedAt: number;
};

/**
 * Привязка ребёнка к группе педагога по 8-символьному коду приглашения.
 *
 * Педагог видит только имя, возраст, факт посещения и ступень выхода на показ —
 * без ответов в историях, без отметок чувств и без домашнего отчёта.
 */
export default function ParentGroupJoin({ profileId, childName }: { profileId: string; childName: string }) {
  const [memberships, setMemberships] = useState<JoinedGroup[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/teacher?profileId=${encodeURIComponent(profileId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { memberships?: JoinedGroup[] };
      setMemberships(data.memberships ?? []);
    } catch {
      /* тихо: карточка не мешает основному кабинету */
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await apiFetch('/api/teacher', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'join', code: trimmed, profileId }),
      });
      const data = (await res.json()) as { error?: string; group?: { name: string; year: number } };
      if (!res.ok) {
        if (data.error === 'invalid_code') setError('Проверьте код: в нём 8 букв и цифр без похожих символов.');
        else if (data.error === 'group_not_found') setError('Группа с таким кодом не найдена.');
        else if (data.error === 'own_group') setError('Нельзя добавить ребёнка в собственную группу педагога.');
        else if (data.error === 'already_member') setError('Ребёнок уже добавлен в эту группу.');
        else setError('Не удалось подключить группу. Попробуйте позже.');
        return;
      }
      setCode('');
      setMessage(`Подключена группа «${data.group?.name ?? ''}» (${data.group?.year ?? ''}).`);
      await load();
    } catch {
      setError('Не удалось отправить код. Проверьте соединение.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async (groupId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const res = await apiFetch('/api/teacher', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'leave', groupId, profileId }),
      });
      if (!res.ok) {
        setError('Не удалось выйти из группы.');
        return;
      }
      setMessage(`Вы отключили группу «${name}». Прежние отметки посещений сохранены.`);
      await load();
    } catch {
      setError('Не удалось обновить участие в группе.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Занятия в группе с педагогом</h2>
      <p className="muted small">
        Если {childName} ходит на очные встречи в школе или кружке, введите код группы от педагога.
        Педагог сможет отмечать посещения и выход на показы, но не увидит ответы из историй, чувства и семейный отчёт.
      </p>

      {memberships.length > 0 && (
        <div className="choice-list compact" style={{ marginBottom: 12 }}>
          {memberships.map((m) => (
            <div key={m.groupId} className="choice" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>Группа «{m.name}»</strong>
                <span className="muted small" style={{ display: 'block' }}>Учебный год {m.year}</span>
              </div>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => void leave(m.groupId, m.name)}
              >
                Выйти из группы
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Код группы (8 знаков)"
          maxLength={12}
          aria-label="Код группы от педагога"
          style={{ flex: '1 1 180px', textTransform: 'uppercase', letterSpacing: '0.08em' }}
        />
        <button type="button" className="btn secondary" disabled={busy || !code.trim()} onClick={() => void join()}>
          Подключить группу
        </button>
      </div>

      {message && <p role="status" className="small" style={{ marginTop: 8 }}>{message}</p>}
      {error && <p role="alert" className="small" style={{ marginTop: 8, color: 'var(--coral)' }}>{error}</p>}

      <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
        Ведёте занятия сами? <Link href="/teacher">Кабинет педагога</Link> · <Link href="/school">Материалы для школы и ФГОС</Link>
      </p>
    </div>
  );
}
