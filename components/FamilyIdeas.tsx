'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type Idea = { id: string; title: string; prompt: string };
type Goal = { confirmed: number; target: number; members: number; reached: boolean; notice: string };
type View = { version: number; completed: number; target: number; ideas: Idea[]; current: (Idea & { instanceId: string; status: 'chosen' | 'reported' | 'confirmed' }) | null; goal?: Goal };
type Command = { action: 'choose' | 'report' | 'confirm' | 'cancel' | 'close'; expectedVersion: number; operationId: string; ideaId?: string };
function operationId(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}
export default function FamilyIdeas({ profileId, parentView = false }: { profileId: string; parentView?: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const busyRef = useRef(false);
  const pending = useRef<Command | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setView(null); setError(''); pending.current = null;
    void (async () => {
      try {
        const res = await apiFetch(`/api/family?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw Error('load');
        const data = await res.json();
        if (!controller.signal.aborted) setView(data);
      } catch { if (!controller.signal.aborted) setError('Не удалось загрузить семейные идеи.'); }
    })();
    return () => controller.abort();
  }, [profileId, reload]);
  const send = async (action?: Command['action'], ideaId?: string) => {
    if (!view || busyRef.current) return;
    let command = pending.current;
    if (!command) {
      if (!action) return;
      try { command = { action, expectedVersion: view.version, operationId: operationId(), ...(ideaId ? { ideaId } : {}) }; }
      catch { setError('Не удалось безопасно подготовить запрос. Обновите экран.'); return; }
      pending.current = command;
    }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const res = await apiFetch('/api/family', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, ...command }) });
      const data = await res.json();
      if (res.status === 409) { pending.current = null; setError('Идея уже изменилась в другом окне. Обновите экран.'); return; }
      if (!res.ok) throw Error('send');
      pending.current = null; setView(data);
    } catch { setError('Не удалось подтвердить действие. Можно повторить отправку без повторного начисления.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <section className="panel family-ideas" aria-label="Семейные идеи">
    <h2>🌱 Семейные идеи</h2>
    <p>Выбирайте только если хочется, с человеком, с которым комфортно. Можно остановиться в любой момент. Наград и штрафов нет.</p>
    {error && <div role="alert" className="request-error">{error} {pending.current ? <button type="button" disabled={busy} onClick={() => void send()}>Повторить отправку</button> : <button type="button" disabled={busy} onClick={() => setReload(n => n + 1)}>Обновить</button>}</div>}
    {!view && !error && <p role="status">Загружаем идеи…</p>}
    {view && <>
      <p>🌼 Общий сад: {Math.min(view.completed, view.target)} из {view.target} отметок. Можно продолжать и после этого.</p>
      {view.goal && <p className="family-goal">🌳 Общая цель семьи: {view.goal.notice}{view.goal.members > 1 ? ' Отметки всех детей семьи складываются.' : ''}</p>}
      <p className="muted">Это совместные отметки, а не проверка того, что произошло. Детский экран и кабинет используют один аккаунт; система не проверяет, кто нажал кнопку.</p>
      <fieldset disabled={busy || Boolean(error)} className="family-controls" aria-busy={busy}>
      {!view.current && (parentView ? <p>Ребёнок может выбрать идею в разделе «Семья». Предлагать и участвовать необязательно.</p> : <div className="family-list">{view.ideas.map(idea => <article key={idea.id} className="family-card"><h3>{idea.title}</h3><p>{idea.prompt}</p><button type="button" className="btn" onClick={() => void send('choose', idea.id)}>Выбрать идею</button></article>)}</div>)}
      {view.current && <article className="family-card"><h3>{view.current.title}</h3><p>{view.current.prompt}</p>
        {view.current.status === 'chosen' && <><p>Идея выбрана. Можно попробовать позже или отказаться.</p>{!parentView && <button type="button" className="btn" onClick={() => void send('report')}>Мы попробовали</button>}</>}
        {view.current.status === 'reported' && <><p>Отметка о попытке ждёт совместного подтверждения.</p>{parentView && <button type="button" className="btn" onClick={() => void send('confirm')}>Подтвердить отметку</button>}</>}
        {view.current.status === 'confirmed' && <><p>Спасибо! Отметка добавлена в общий сад.</p><button type="button" className="btn" onClick={() => void send('close')}>Завершить</button></>}
        {view.current.status !== 'confirmed' && <button type="button" className="btn ghost" onClick={() => void send('cancel')}>Отказаться от идеи</button>}
      </article>}
      </fieldset>
    </>}
  </section>;
}
