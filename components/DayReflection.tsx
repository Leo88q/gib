'use client';
import { useState } from 'react';
import { nextJourneyStage } from '@/lib/day/journey-machine';
import useJourneyResume from './useJourneyResume';

/**
 * Необязательный итог: без личности, наград, аналитики и сети.
 * После перезагрузки возвращается только сам экран; выбор не сохраняется.
 */
export default function DayReflection({ onDone, profileId, day }: { onDone: () => void; profileId?: string; day?: number }) {
  const resume = useJourneyResume({ profileId, day, screen: 'reflection' });
  const [selected, setSelected] = useState<string | null>(null);
  const options = ['История', 'Задания', 'Пока не знаю'];
  return <main className="wrap day-reflection"><div className="panel">
    <span className="chip">Необязательный итог</span><h1>Что тебе запомнилось?</h1>
    {resume.restored && <p className="muted" role="status">Ты вернулся на экран итога. Выбор не сохранялся — можно ответить заново или просто уйти домой.</p>}
    <p>Можно выбрать карточку, передумать или ничего не выбирать.</p>
    <div className="reflection-options" role="group" aria-label="Что запомнилось">
      {options.map((option, i) => <button type="button" key={option} aria-pressed={selected === option} onClick={() => setSelected(old => old === option ? null : option)}><span aria-hidden="true">{['📖', '🧩', '💭'][i]}</span>{option}</button>)}
    </div>
    <p aria-live="polite">{selected ? `Выбрано: ${selected.toLowerCase()}. Можно изменить или снять выбор.` : 'Можно пропустить этот вопрос.'}</p>
    <p className="muted">Ответ виден только на этом экране. Он не сохраняется, не отправляется родителю и не влияет на награды.</p>
    <button className="btn big" type="button" onClick={() => { if(nextJourneyStage('reflection',{type:'reflection_done'}) === 'completed') { resume.clear(); onDone(); } }}>Домой</button>
  </div></main>;
}
