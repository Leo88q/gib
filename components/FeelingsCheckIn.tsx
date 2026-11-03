'use client';
import { useState } from 'react';
import { FEELINGS, FEELING_PROMPTS, toggleFeeling, type FeelingId } from '@/lib/content/feelings-checkin';
import type { AgeBand } from '@/lib/types';
import ReadAloud from './ReadAloud';

/** Private, ephemeral check-in: no scoring, reporting, network calls or storage. */
export default function FeelingsCheckIn({ band }: { band: AgeBand }) {
  const [selected, setSelected] = useState<FeelingId[]>([]);
  const labels = selected.map(id => FEELINGS.find(feeling => feeling.id === id)!.label.toLowerCase());
  return <div className="support-game feelings-game">
    <h3>Как я сейчас?</h3>
    <p>{FEELING_PROMPTS[band]}</p>
    <ReadAloud text={FEELING_PROMPTS[band]} />
    <p className="muted">Чувства могут быть разными и меняться. Картинки — только подсказки, а не оценка.</p>
    <div className="feelings-grid" role="group" aria-label="Выбери подходящие слова">
      {FEELINGS.map(feeling => <button type="button" key={feeling.id} aria-pressed={selected.includes(feeling.id)} onClick={() => setSelected(previous => toggleFeeling(previous, feeling.id))}>
        <img src={feeling.icon} alt="" width="56" height="56" /><span>{feeling.label}</span>
      </button>)}
    </div>
    <p className="feelings-status" aria-live="polite">{labels.length ? `Ты отметил: ${labels.join(', ')}. Можно изменить выбор.` : 'Ничего не выбрано. Можно просто пропустить.'}</p>
    {selected.length > 0 && <button type="button" className="btn ghost" onClick={() => setSelected([])}>Снять отметки</button>}
    <p className="muted">Если хочется, можно рассказать взрослому, которому доверяешь. Отметки не сохраняются и не отправляются в отчёт.</p>
    <small>Значки: <a href="https://openmoji.org/">OpenMoji</a>, <a href="/licenses/openmoji-cc-by-sa-4.0.txt">CC BY-SA 4.0</a>, без изменений.</small>
  </div>;
}
