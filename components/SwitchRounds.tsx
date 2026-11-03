'use client';
import { useEffect, useRef, useState } from 'react';
import { ShapeCardView, type ShapeCard } from './Shape';
import { cardName } from '@/lib/content/visual-labels';
import { parseSwitchDraft, type SwitchDraft } from '@/lib/switch-draft';
import ReadAloud from './ReadAloud';

type Rule = 'shape' | 'color';
const ruleText = (rule: Rule) => rule === 'shape' ? 'Найди лишнюю по форме' : 'Найди лишнюю по цвету';
export default function SwitchRounds({ cards, rules, draftKey, onSubmit }: { cards: ShapeCard[]; rules: Rule[]; draftKey?: string; onSubmit: (cells: number[]) => void }) {
  const signature = JSON.stringify([cards, rules]);
  const [draft, setDraft] = useState<SwitchDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const current = useRef<SwitchDraft | null>(null);
  useEffect(() => {
    let recovered: SwitchDraft | null = null;
    try { if (draftKey) recovered = parseSwitchDraft(sessionStorage.getItem(draftKey), signature, rules.length, cards.length); } catch { /* optional storage */ }
    const initial = recovered ?? { signature, round: 0, answers: rules.map(() => null) };
    current.current = initial;
    setDraft(initial);
    setRestored(Boolean(recovered));
  }, [draftKey, signature, cards.length, rules.length]);
  const update = (next: SwitchDraft) => {
    current.current = next;
    setDraft(next);
    try { if (draftKey) sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* play remains available */ }
  };
  if (!draft || !current.current || draft.signature !== signature) return <p role="status">Подготавливаем карточки…</p>;
  const { round, answers } = draft;
  const selected = answers[round];
  const label = ruleText(rules[round]);
  const choose = (index: number) => {
    const previous = current.current!;
    update({ ...previous, answers: previous.answers.map((value, i) => i === previous.round ? index : value) });
  };
  const goTo = (nextRound: number) => update({ ...current.current!, round: nextRound });
  return <div>
    {restored && <p className="muted" role="status">Твои выборы восстановлены в этой вкладке.</p>}
    <p className="switch-rule" role="status">Раунд {round + 1} из {rules.length}: {label}</p>
    <ReadAloud text={`Раунд ${round + 1}. ${label}.`} />
    <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} role="group" aria-label={`Карточки: ${label}`}>
      {cards.map((card, i) => <ShapeCardView key={i} card={card} selected={selected === i} onClick={() => choose(i)} />)}
    </div>
    <p className="muted" aria-live="polite">{selected == null ? 'Выбери фигурку. Можно изменить выбор.' : `Выбрано: ${cardName(cards[selected].shape, cards[selected].color)}.`}</p>
    <div className="switch-nav">
      {round > 0 && <button type="button" className="btn ghost" onClick={() => goTo(round - 1)}>← Предыдущее правило</button>}
      {round < rules.length - 1 ? <button type="button" className="btn" disabled={selected == null} onClick={() => goTo(round + 1)}>Следующее правило →</button> :
        <button type="button" className="btn" disabled={answers.some(value => value === null)} onClick={() => onSubmit(answers as number[])}>Проверить ответы</button>}
    </div>
    <p className="muted">Карточки не меняются. Вернись назад, если хочешь исправить ответ.</p>
  </div>;
}
