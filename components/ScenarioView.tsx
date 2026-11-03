'use client';

import { useEffect, useRef, useState } from 'react';
import SupportKit from './SupportKit';
import ReadAloud from './ReadAloud';
import { AGE_REFLECTIONS } from '@/lib/content/age-reflection';
import { REFLECTIONS } from '@/lib/content/reflection';
import type { AgeBand, CompetencyId } from '@/lib/types';

export type ScenarioVariantPublic = {
  title: string;
  text: string;
  options: { text: string }[];
  followUps?: { text: string; choices: string[] }[];
};

export default function ScenarioView({ scenario, onAnswer, band, draftKey }: {
  scenario: { scenarioId: string; competency: string; skillLabel: string; variant: ScenarioVariantPublic };
  onAnswer: (answer: { index: number; cells?: number[] }) => Promise<void>;
  draftKey?: string;
  band: AgeBand;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [secondPage, setSecondPage] = useState(false);
  const [followChoice, setFollowChoice] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const signature = JSON.stringify(scenario.variant);
  const identity = JSON.stringify([draftKey ?? null, signature]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const ready = identity === loaded;
  const heading = useRef<HTMLHeadingElement>(null);
  const focusPage = useRef(false);
  useEffect(() => { if (focusPage.current && ready) { heading.current?.focus(); focusPage.current=false; } }, [secondPage, ready]);
  useEffect(() => {
    let state: { index:number; second:boolean; follow:number | null } | null = null;
    try {
      const raw = draftKey && scenario.variant.followUps ? sessionStorage.getItem(draftKey) : null;
      const d = raw ? JSON.parse(raw) : null;
      if (d && d.signature === signature && Number.isInteger(d.index) && d.index >= 0 && d.index < scenario.variant.options.length && typeof d.second === 'boolean' && (d.follow === null || (Number.isInteger(d.follow) && d.follow >= 0 && d.follow < (scenario.variant.followUps?.[d.index]?.choices.length ?? 0)))) state=d;
    } catch { /* tab storage is optional */ }
    setSelected(state?.index ?? null);setSecondPage(state?.second ?? false);setFollowChoice(state?.follow ?? null);setRestored(Boolean(state));setLoaded(identity);
  }, [identity, draftKey, signature]);
  useEffect(() => {
    if (!ready || !draftKey || !scenario.variant.followUps) return;
    try {
      if (selected !== null) sessionStorage.setItem(draftKey, JSON.stringify({ signature, index:selected, second:secondPage, follow:followChoice }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* still playable without storage */ }
  }, [ready, draftKey, signature, selected, secondPage, followChoice]);
  const go = (value:boolean) => { if (value !== secondPage) { focusPage.current=true; setSecondPage(value); } };
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [reflectionChoice, setReflectionChoice] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const reflection = REFLECTIONS[scenario.competency as CompetencyId];
  const prompt = AGE_REFLECTIONS[scenario.competency as CompetencyId]?.[band] ?? reflection?.prompt;
  const submit = async () => {
    if (selected === null || submitted || !ready || (scenario.variant.followUps && followChoice === null)) return;
    setSubmitted(true); setError(false);
    try { await onAnswer({ index: selected, ...(scenario.variant.followUps ? { cells: [followChoice!] } : {}) }); }
    catch { setError(true); }
    finally { setSubmitted(false); }
  };
  return <div>
    <div className="task-head"><span className="chip">{scenario.skillLabel}</span><span className="chip">Жизненная ситуация</span></div>
    <h2 ref={heading} tabIndex={-1}>{scenario.variant.title}</h2>
    {restored && <p role="status" className="muted">История восстановлена в этой вкладке. Выбор можно изменить.</p>}
    {scenario.variant.followUps && secondPage && selected !== null ? <div className="story-second-page">
      <span className="chip">Продолжение · 2 из 2</span>
      <p className="story-second-text">{scenario.variant.followUps[selected].text}</p>
      <ReadAloud text={`${scenario.variant.followUps[selected].text} ${scenario.variant.followUps[selected].choices.join('. ')}`} />
      <div className="options">{scenario.variant.followUps[selected].choices.map((choice, i) => <button key={i} type="button" className={`option${followChoice === i ? ' scenario-selected' : ''}`} aria-pressed={followChoice === i} disabled={!ready || submitted} onClick={() => setFollowChoice(i)}>{choice}</button>)}</div>
      <p className="muted" aria-live="polite">{followChoice === null ? 'Выбери, как продолжится история.' : 'Можно изменить выбор.'}</p>
      <button type="button" className="btn ghost" disabled={submitted} onClick={() => go(false)}>← К первой части</button>
      <button type="button" className="btn big" disabled={!ready || submitted || followChoice === null} onClick={submit}>Завершить историю →</button>
    </div> : <>
    {scenario.variant.followUps && <span className="chip">История · 1 из 2</span>}
    <p style={{ fontSize: 18, marginBottom: 16 }}>{scenario.variant.text}</p>
    <ReadAloud text={`${scenario.variant.title}. ${scenario.variant.text} Что ты сделаешь? ${scenario.variant.options.map((o, i) => `Вариант ${i + 1}. ${o.text}`).join(' ')}`} />
    <p className="muted" style={{ marginBottom: 10 }}>Что ты сделаешь?</p>
    <div className="options">{scenario.variant.options.map((o, i) =>
      <button key={i} type="button" className={`option${selected === i ? ' scenario-selected' : ''}`} aria-pressed={selected === i} disabled={submitted} onClick={() => { setSelected(i); setFollowChoice(null); setReflectionOpen(false); setReflectionChoice(null); }}>
        {o.text}
      </button>)}</div>
    {selected !== null && <div className="scenario-confirm">
      <p>Ты выбрал: «{scenario.variant.options[selected].text}». Можно изменить выбор.</p>
      {reflection && !reflectionOpen && <button type="button" className="story-reflect-btn" disabled={submitted} onClick={() => setReflectionOpen(true)}>🔎 Подумать вместе с Лисом</button>}
      {reflection && reflectionOpen && <div className="reflection-box">
        <p><strong>Лис спрашивает:</strong> {prompt}</p>
        <div className="reflection-choices">{reflection.choices.map((choice, i) => <button key={choice.label} type="button" disabled={submitted} aria-pressed={reflectionChoice === i} onClick={() => setReflectionChoice(i)}>{choice.label}</button>)}</div>
        {reflectionChoice !== null && <p className="reflection-reply" aria-live="polite">🦊 {reflection.choices[reflectionChoice].response}</p>}
        <small>Здесь нет оценки; можно выбрать несколько вариантов по очереди.</small>
      </div>}
      <button type="button" className="btn big" disabled={!ready || submitted} onClick={() => scenario.variant.followUps ? go(true) : void submit()}>Продолжить историю →</button>
    </div>}
    </>}
    {error && <p role="alert">Не удалось отправить ответ. Проверь связь и попробуй снова.</p>}
    <SupportKit competency={scenario.competency} band={band} />
  </div>;
}
