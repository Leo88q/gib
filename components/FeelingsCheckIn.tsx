'use client';
import { useEffect, useState } from 'react';
import { FEELINGS, FEELING_PROMPTS, toggleFeeling, type FeelingId } from '@/lib/content/feelings-checkin';
import type { AgeBand } from '@/lib/types';
import { apiFetch } from '@/lib/telegramClient';
import ReadAloud from './ReadAloud';

/**
 * Отметка чувств перед миссией.
 *
 * По умолчанию всё живёт только в памяти экрана. Если взрослый дал согласие,
 * появляется отдельная кнопка «Сохранить» — не автоматически: ребёнок решает
 * сам, и отказ ни на что не влияет.
 */
export default function FeelingsCheckIn({ band, profileId }: { band: AgeBand; profileId?: string }) {
  const [selected, setSelected] = useState<FeelingId[]>([]);
  const [canSave, setCanSave] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const labels = selected.map(id => FEELINGS.find(feeling => feeling.id === id)!.label.toLowerCase());

  // Согласие проверяем один раз и без шума: если сервер недоступен, сохранения просто нет.
  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch(`/api/feelings?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (!controller.signal.aborted) setCanSave(Boolean(data.enabled));
      } catch { /* сохранение необязательно */ }
    })();
    return () => controller.abort();
  }, [profileId]);

  const save = async () => {
    if (!profileId || selected.length === 0 || saveState === 'saving') return;
    setSaveState('saving');
    try {
      const res = await apiFetch('/api/feelings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, action: 'checkin', feelings: selected }) });
      setSaveState(res.ok ? 'saved' : 'error');
    } catch { setSaveState('error'); }
  };

  return <div className="support-game feelings-game">
    <h3>Как я сейчас?</h3>
    <p>{FEELING_PROMPTS[band]}</p>
    <ReadAloud text={FEELING_PROMPTS[band]} />
    <p className="muted">Чувства могут быть разными и меняться. Картинки — только подсказки, а не оценка.</p>
    <div className="feelings-grid" role="group" aria-label="Выбери подходящие слова">
      {FEELINGS.map(feeling => <button type="button" key={feeling.id} aria-pressed={selected.includes(feeling.id)} onClick={() => { setSelected(previous => toggleFeeling(previous, feeling.id)); setSaveState('idle'); }}>
        <img src={feeling.icon} alt="" width="56" height="56" /><span>{feeling.label}</span>
      </button>)}
    </div>
    <p className="feelings-status" aria-live="polite">{labels.length ? `Ты отметил: ${labels.join(', ')}. Можно изменить выбор.` : 'Ничего не выбрано. Можно просто пропустить.'}</p>
    {selected.length > 0 && <button type="button" className="btn ghost" onClick={() => { setSelected([]); setSaveState('idle'); }}>Снять отметки</button>}
    {canSave && selected.length > 0 && saveState !== 'saved' && <button type="button" className="btn" disabled={saveState === 'saving'} onClick={() => void save()}>{saveState === 'saving' ? 'Сохраняем…' : 'Сохранить мою отметку'}</button>}
    {saveState === 'saved' && <p role="status">Отметка сохранена. Её можно удалить в любой момент в кабинете взрослого.</p>}
    {saveState === 'error' && <p role="alert">Не удалось сохранить. Можно просто пропустить — на игру это не влияет.</p>}
    <p className="muted">Если хочется, можно рассказать взрослому, которому доверяешь. {canSave ? 'Сохранение — по желанию, на награды не влияет и в отчёт по занятиям не попадает.' : 'Отметки не сохраняются и не отправляются в отчёт.'}</p>
    <small>Значки: <a href="https://openmoji.org/">OpenMoji</a>, <a href="/licenses/openmoji-cc-by-sa-4.0.txt">CC BY-SA 4.0</a>, без изменений.</small>
  </div>;
}
