'use client';
import { useEffect, useRef, useState } from 'react';
import { ActiveTimer } from '@/lib/active-timer';
import { parseSupportDraft } from '@/lib/support-draft';
import type { SupportRound } from '@/lib/content/support-practice';
import ReadAloud from './ReadAloud';

/** The notebook is a presentation of the existing unscored three-card task; it does not alter the answer contract. */
export default function SupportPractice({ rounds, draftKey, onAnswer, onSkip }: { rounds: SupportRound[]; draftKey?: string; onAnswer: (choices: number[], ms: number) => void; onSkip: (ms: number) => void }) {
  const timer = useRef(new ActiveTimer());
  useEffect(() => {
    timer.current.reset(performance.now(), document.visibilityState === 'visible');
    const change = () => timer.current.setVisible(document.visibilityState === 'visible', performance.now());
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  const signature = JSON.stringify(rounds);
  const [choices, setChoices] = useState<(number | null)[]>(() => rounds.map(() => null));
  const [page, setPage] = useState(0);
  const identity = JSON.stringify([draftKey ?? null, signature]);
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const ready = loadedIdentity === identity;
  const pageHeading = useRef<HTMLElement | null>(null);
  const focusNextPage = useRef(false);
  const goToPage = (next: number) => { if (next !== page) { focusNextPage.current = true; setPage(next); } };
  useEffect(() => { if (focusNextPage.current && ready) { pageHeading.current?.focus(); focusNextPage.current = false; } }, [page, ready]);
  const [restored, setRestored] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  useEffect(() => {
    let d: (number | null)[] | null = null;
    try { d = draftKey ? parseSupportDraft(sessionStorage.getItem(draftKey), signature, rounds.map(r => r.options.length)) : null; }
    catch { /* tab storage is optional */ }
    const initial = d ?? rounds.map(() => null);
    setChoices(initial);
    setRestored(Boolean(d?.some(v => v !== null)));
    const firstEmpty = initial.findIndex(v => v === null);
    setPage(firstEmpty < 0 ? rounds.length : firstEmpty);
    setLoadedIdentity(identity);
  }, [draftKey, signature, identity]);
  useEffect(() => {
    if (!ready || !draftKey) return;
    try {
      if (choices.some(v => v !== null)) sessionStorage.setItem(draftKey, JSON.stringify({ signature, choices }));
      else sessionStorage.removeItem(draftKey);
    } catch { /* still playable without storage */ }
  }, [ready, draftKey, signature, choices]);
  const done = choices.filter(v => v !== null).length;
  const review = page === rounds.length;
  const current = rounds[page];
  return <div className="support-practice">
    <div className="task-head"><span className="chip">Мастерская идей</span><span className="chip">Без оценки</span></div>
    <h2>Книжка идей</h2>
    <p>Собери по одной идее для каждой ситуации. Это выдуманная история: правильного ответа здесь нет.</p>
    {restored && <p role="status" className="muted">Твои незавершённые выборы восстановлены в этой вкладке.</p>}
    <div className="idea-notebook">
      <div className="idea-notebook-top"><span aria-hidden="true">✦</span><strong>Страницы мастерской</strong><span aria-hidden="true">✦</span></div>
      <nav className="idea-pages" aria-label="Страницы книжки идей">
        {rounds.map((round, i) => <button type="button" key={i} disabled={!ready} aria-current={page === i ? 'step' : undefined} aria-label={`Ситуация ${i + 1}: ${choices[i] === null ? 'идея не выбрана' : 'идея выбрана'}`} className={`idea-page${page === i ? ' current' : ''}${choices[i] !== null ? ' filled' : ''}`} onClick={() => goToPage(i)}><span aria-hidden="true">{choices[i] === null ? i + 1 : '✓'}</span><span className="idea-page-label">Ситуация {i + 1}</span></button>)}
        <button type="button" disabled={!ready || done !== rounds.length} aria-current={review ? 'step' : undefined} className={`idea-page idea-review-tab${review ? ' current' : ''}`} onClick={() => goToPage(rounds.length)}>Все идеи</button>
      </nav>
      <p className="idea-progress" aria-live="polite">Идей в книжке: {done} из {rounds.length}</p>
      {ready && !review && current && <fieldset className="support-round" key={page}>
        <legend ref={el => { pageHeading.current = el; }} tabIndex={-1}>Ситуация {page + 1} из {rounds.length}</legend>
        <p className="idea-prompt">{current.prompt}</p>
        <ReadAloud text={`${current.prompt} ${current.options.join('. ')}`} />
        <p className="idea-hint">Выбери идею. Её можно изменить.</p>
        <div className="support-round-options">{current.options.map((option, j) => <button type="button" key={j} aria-pressed={choices[page] === j} className={choices[page] === j ? 'selected' : ''} onClick={() => setChoices(old => old.map((v, index) => index === page ? j : v))}><span className="idea-option-mark" aria-hidden="true">{choices[page] === j ? '✓' : '✦'}</span><span>{option}</span></button>)}</div>
        <div className="idea-navigation">
          {page > 0 && <button type="button" className="btn ghost" onClick={() => goToPage(page - 1)}>← Назад</button>}
          <button type="button" className="btn" disabled={choices[page] === null} onClick={() => {
            const nextEmpty = choices.findIndex((v, i) => i > page && v === null);
            const anyEmpty = choices.findIndex(v => v === null);
            goToPage(nextEmpty >= 0 ? nextEmpty : anyEmpty >= 0 ? anyEmpty : rounds.length);
          }}>{done === rounds.length ? 'Посмотреть все идеи →' : 'Следующая ситуация →'}</button>
        </div>
      </fieldset>}
      {ready && review && <section className="idea-summary" aria-labelledby="idea-summary-title">
        <h3 id="idea-summary-title" ref={el => { pageHeading.current = el; }} tabIndex={-1}>Твои идеи для истории</h3><p>Можно вернуться к любой ситуации и изменить идею.</p>
        <ol>{rounds.map((round, i) => <li key={i}><strong>{round.prompt}</strong><p>{round.options[choices[i]!]}</p><button type="button" className="idea-edit" onClick={() => goToPage(i)} aria-label={`Изменить идею для ситуации ${i + 1}`}>Изменить</button></li>)}</ol>
        <button type="button" className="btn big" disabled={done !== rounds.length} onClick={() => onAnswer(choices as number[], timer.current.elapsed(performance.now()))}>Готово →</button>
      </section>}
    </div>
    {!confirmSkip ? <button type="button" className="btn ghost" onClick={() => setConfirmSkip(true)}>Пропустить упражнение</button> : <div className="skip-confirm" role="group" aria-label="Подтверждение пропуска"><p>Пропустить? Миссия и награда не изменятся.</p><button type="button" className="btn" onClick={() => onSkip(timer.current.elapsed(performance.now()))}>Да, пропустить</button><button type="button" className="btn ghost" onClick={() => setConfirmSkip(false)}>Остаться</button></div>}
  </div>;
}
