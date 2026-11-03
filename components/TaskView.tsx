'use client';

import { useEffect, useRef, useState } from 'react';
import { Shape, ShapeCardView } from './Shape';
import ReadAloud from './ReadAloud';
import LogicBoard from './LogicBoard';
import SwitchRounds from './SwitchRounds';
import type { LogicBoard as LogicBoardData } from '@/lib/content/logic-puzzles';
import { cardName, colorName, positionName } from '@/lib/content/visual-labels';
import { moveSelection, toggleSelection } from '@/lib/content/sequence-selection';
import { ActiveTimer } from '@/lib/active-timer';
import { parseSelectionDraft } from '@/lib/selection-draft';

export type TaskInstance = {
  taskId: string;
  skill: string;
  title: string;
  prompt: string;
  hint?: string;
  rounds?: import('@/lib/content/support-practice').SupportRound[];
  kind: 'choice' | 'memory' | 'symbol-memory' | 'digits' | 'gonogo' | 'finddiff' | 'cards' | 'order' | 'switch-rounds' | 'social-practice';
  options?: { id: string; label: string; color?: string }[];
  bigText?: string;
  bigColor?: string;
  cards?: { shape: string; color: string }[];
  targetCard?: { shape: string; color: string };
  ruleLabel?: string;
  rules?: ('shape' | 'color')[];
  logicBoard?: LogicBoardData;
  steps?: string[];
  rows?: number;
  cols?: number;
  cells?: number[];
  digits?: number[];
  grid?: { color: string }[];
};

export type AnswerPayload = {
  index?: number;
  cells?: number[];
  digits?: string;
  targets?: number[];
  assisted?: boolean;
  skip?: true;
};

const SKILL_LABEL: Record<string, string> = {
  attention: 'Внимание',
  working_memory: 'Рабочая память',
  flexibility: 'Гибкость',
  inhibition: 'Торможение',
  planning: 'Планирование',
  logic: 'Логика',
};

export default function TaskView({
  instance,
  onAnswer,
  resumedPractice = false,
  draftKey,
  selectionKey,
}: {
  instance: TaskInstance;
  resumedPractice?: boolean;
  draftKey?: string;
  selectionKey?: string;
  onAnswer: (answer: AnswerPayload, ms: number) => void;
}) {
  const timer = useRef(new ActiveTimer());
  const sequenceStarted = useRef(false);
  const phaseRef = useRef<'show' | 'input'>('show');
  const [visible, setVisible] = useState(true);
  const [interrupted, setInterrupted] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [singlePick, setSinglePick] = useState<number | null>(null);
  const [viewRound, setViewRound] = useState(0);
  const [assisted, setAssisted] = useState(false);
  const [flashIndex, setFlashIndex] = useState(-1);
  const [phase, setPhase] = useState<'show' | 'input'>('show');
  const [digitsInput, setDigitsInput] = useState('');
  const [shownDigits, setShownDigits] = useState<number[] | null>(null);

  const draftCount = instance.kind === 'order' ? instance.steps?.length ?? 0 : instance.kind === 'finddiff' ? instance.cards?.length ?? 0 : instance.kind === 'gonogo' ? instance.grid?.length ?? 0 : 0;
  const draftSignature = JSON.stringify([instance.kind, instance.steps, instance.cards, instance.targetCard, instance.grid, instance.prompt]);
  const [draftReady, setDraftReady] = useState(false);
  const [selectionRestored, setSelectionRestored] = useState(false);
  useEffect(() => {
    let restored = null;
    try { if (selectionKey && draftCount) restored = parseSelectionDraft(sessionStorage.getItem(selectionKey), draftSignature, draftCount); } catch { /* storage is optional */ }
    if (restored?.picked.length) { setPicked(restored.picked); setSelectionRestored(true); }
    setDraftReady(true);
  }, [selectionKey, draftSignature, draftCount]);

  const updatePicked = (update: (previous: number[]) => number[]) => {
    setPicked(previous => {
      const next = update(previous);
      // Persist in an effect instead: React may invoke state updaters more than once.
      return next;
    });
  };
  useEffect(() => {
    if (!draftReady || !selectionKey || !draftCount) return;
    try {
      if (picked.length) sessionStorage.setItem(selectionKey, JSON.stringify({ signature: draftSignature, picked }));
      else sessionStorage.removeItem(selectionKey);
    } catch { /* play remains available */ }
  }, [draftReady, selectionKey, draftCount, draftSignature, picked]);

  // Hidden time must not count as response time. Interrupted sequences restart.
  useEffect(() => {
    const isVisible = () => document.visibilityState !== 'hidden';
    timer.current.reset(performance.now(), isVisible());
    setVisible(isVisible());
    const change = () => {
      const show = isVisible();
      timer.current.setVisible(show, performance.now());
      if (!show && phaseRef.current === 'show' && (instance.kind === 'memory' || instance.kind === 'symbol-memory' || instance.kind === 'digits')) {
        if (sequenceStarted.current) { setAssisted(true); setInterrupted(true); }
        setViewRound(n => n + 1);
      }
      if (!show) { setFlashIndex(-1); setShownDigits(null); }
      setVisible(show);
    };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, [instance.kind]);

  // показ последовательности (память / цифры)
  useEffect(() => {
    if (!visible || phase !== 'show') return;
    sequenceStarted.current = false;
    if ((instance.kind === 'memory' || instance.kind === 'symbol-memory') && instance.cells?.length) {
      const seq = instance.cells;
      let i = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const step = () => {
        if (document.visibilityState === 'hidden') return;
        if (i >= seq.length) {
          timers.push(setTimeout(() => { if (document.visibilityState === 'hidden') return; timer.current.reset(performance.now(), true); phaseRef.current = 'input'; setPhase('input'); }, 600));
          return;
        }
        sequenceStarted.current = true;
        setFlashIndex(seq[i]);
        timers.push(setTimeout(() => setFlashIndex(-1), 550));
        i += 1;
        timers.push(setTimeout(step, 750));
      };
      timers.push(setTimeout(step, 700));
      return () => timers.forEach(clearTimeout);
    }
    if (instance.kind === 'digits' && instance.digits?.length) {
      const seq = instance.digits;
      let i = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const step = () => {
        if (document.visibilityState === 'hidden') return;
        if (i >= seq.length) {
          timers.push(setTimeout(() => { if (document.visibilityState === 'hidden') return; setShownDigits(null); timer.current.reset(performance.now(), true); phaseRef.current = 'input'; setPhase('input'); }, 850));
          return;
        }
        sequenceStarted.current = true;
        setShownDigits([seq[i]]);
        i += 1;
        timers.push(setTimeout(step, 850));
      };
      timers.push(setTimeout(step, 600));
      return () => timers.forEach(clearTimeout);
    }
    return undefined;
  }, [instance.kind, instance.cells, instance.digits, viewRound, visible, phase]);

  const replay = () => { setAssisted(true); setPicked([]); setDigitsInput(''); setFlashIndex(-1); setShownDigits(null); phaseRef.current = 'show'; setPhase('show'); setViewRound(n => n + 1); };
  const elapsed = () => timer.current.elapsed(performance.now());

  const submit = (answer: AnswerPayload) => onAnswer(assisted ? { ...answer, assisted: true } : answer, elapsed());

  const toggle = (i: number) => {
    updatePicked((prev) => toggleSelection(prev, i));
  };

  /* ------------------------------- варианты ------------------------------- */
  if (instance.kind === 'choice') {
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        {instance.bigText && (
          <div className="big-word" style={{ color: 'var(--ink)' }}>
            <span style={{ color: ({ red: '#d7243c', blue: '#245cd4', green: '#087d4b', yellow: '#9a6500', purple: '#7240c8', orange: '#a74e00' } as Record<string, string>)[instance.bigColor ?? ''] ?? '#252139', padding: '6px 18px', borderRadius: 14, display: 'inline-block' }}>
              {instance.bigText}
            </span>
          </div>
        )}
        {instance.logicBoard && <LogicBoard board={instance.logicBoard} onPractice={() => setAssisted(true)} />}
        <div className="options">
          {instance.options?.map((o, i) => (
            <button
              key={o.id + i}
              type="button"
              className={`option${singlePick === i ? ' scenario-selected' : ''}`}
              aria-pressed={singlePick === i}
              style={o.color ? { borderColor: o.color } : undefined}
              onClick={() => setSinglePick(i)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="muted" aria-live="polite">{singlePick === null ? 'Выбери вариант — его можно изменить.' : `Выбрано: ${instance.options?.[singlePick]?.label}`}</p>
        <button type="button" className="btn" disabled={singlePick === null} onClick={() => singlePick !== null && submit({ index: singlePick })}>Подтвердить выбор</button>
      </div>
    );
  }

  /* ------------------------- «лишняя карточка» ------------------------- */
  if (instance.kind === 'cards') {
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        {instance.ruleLabel && <div className="chip" style={{ marginBottom: 12 }}>Правило: {instance.ruleLabel}</div>}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {instance.cards?.map((c, i) => (
            <ShapeCardView key={i} card={c} selected={singlePick === i} onClick={() => setSinglePick(i)} />
          ))}
        </div>
        <p className="muted" aria-live="polite">{singlePick === null ? 'Выбери карточку — её можно изменить.' : `Выбрано: ${cardName(instance.cards![singlePick].shape, instance.cards![singlePick].color)}`}</p>
        <button type="button" className="btn" disabled={singlePick === null} onClick={() => singlePick !== null && submit({ index: singlePick })}>Подтвердить выбор</button>
      </div>
    );
  }

  if (instance.kind === 'switch-rounds') {
    return <div>
      <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
      <SwitchRounds cards={instance.cards ?? []} rules={instance.rules ?? []} draftKey={draftKey} onSubmit={cells => submit({ cells })} />
    </div>;
  }

  /* ------------------------------ память ------------------------------ */
  if (instance.kind === 'memory' || instance.kind === 'symbol-memory') {
    const cols = instance.cols ?? 3;
    const total = (instance.rows ?? 3) * cols;
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        <div className="grid cells" style={{ ['--cols' as string]: cols }}>
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`cell${instance.kind === 'symbol-memory' ? ' shape-cell' : ''}${flashIndex === i ? ' lit' : ''}${picked.includes(i) ? ' picked' : ''}`}
              disabled={phase === 'show'}
              aria-label={`${positionName(i, cols)}${instance.kind === 'symbol-memory' && instance.cards?.[i] ? `, ${cardName(instance.cards[i].shape, instance.cards[i].color)}` : ''}${picked.includes(i) ? `, выбран под номером ${picked.indexOf(i) + 1}` : ''}`}
              aria-pressed={picked.includes(i)}
              onClick={() => phase === 'input' && toggle(i)}
            >
              {instance.kind === 'symbol-memory' && instance.cards?.[i] && <Shape shape={instance.cards[i].shape} color={instance.cards[i].color} size={40} />}
              {instance.kind === 'symbol-memory' ? (flashIndex === i || picked.includes(i)) && <span className="memory-badge" aria-hidden="true">{flashIndex === i ? '✦' : picked.indexOf(i) + 1}</span> : flashIndex === i ? '✦' : picked.indexOf(i) + 1 || ''}
            </button>
          ))}
        </div>
        {phase === 'show' ? (
          <p className="muted" role="status" style={{ textAlign: 'center' }}>{flashIndex >= 0 ? `Огонёк: ${instance.kind === 'symbol-memory' && instance.cards?.[flashIndex] ? cardName(instance.cards[flashIndex].shape, instance.cards[flashIndex].color) : positionName(flashIndex, cols)}` : interrupted ? 'Показ начался заново. Это будет практика.' : 'Смотри внимательно…'}</p>
        ) : (
          <>
            <p className="muted" style={{ textAlign: 'center' }}>
              Повтори порядок: нажато {picked.length} из {instance.cells?.length}
            </p>
            <button type="button" className="btn" disabled={picked.length !== instance.cells?.length} onClick={() => submit({ cells: picked })}>
              Готово
            </button>
            <button type="button" className="btn ghost" onClick={replay}>Посмотреть ещё раз (практика)</button>
            <details className="task-help" onToggle={e => { if (e.currentTarget.open) setAssisted(true); }}><summary onClick={() => setAssisted(true)}>Текстовый вариант последовательности (практика с подсказкой)</summary><p>{instance.cells?.map(i => instance.kind === 'symbol-memory' && instance.cards?.[i] ? cardName(instance.cards[i].shape, instance.cards[i].color) : positionName(i, cols)).join(' → ')}</p></details>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------- цифры ------------------------------- */
  if (instance.kind === 'digits') {
    const len = instance.digits?.length ?? 0;
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        {interrupted && <p role="status" className="muted">Показ начался заново. Это будет практика.</p>}
        <div className="big-word" style={{ fontSize: 40 }} aria-live="polite">
          {phase === 'input' ? (digitsInput || '•'.repeat(len)) : shownDigits === null ? '••••' : shownDigits.join(' ')}
        </div>
        {phase === 'input' && (
          <>
            <p className="muted" style={{ textAlign: 'center' }}>
              Набери {len} цифр по порядку
            </p>
            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" className="key" onClick={() => setDigitsInput((s) => (s.length < len ? s + d : s))}>
                  {d}
                </button>
              ))}
              <button type="button" className="key" aria-label="Удалить последнюю цифру" onClick={() => setDigitsInput((s) => s.slice(0, -1))}>
                ⌫
              </button>
              <button type="button" className="key" onClick={() => setDigitsInput((s) => (s.length < len ? s + '0' : s))}>
                0
              </button>
              <button type="button" className="key wide" disabled={digitsInput.length !== len} onClick={() => submit({ digits: digitsInput })}>
                Проверить
              </button>
            </div>
            <button type="button" className="btn ghost" onClick={replay}>Посмотреть цифры ещё раз (практика)</button>
            <details className="task-help" onToggle={e => { if (e.currentTarget.open) setAssisted(true); }}><summary onClick={() => setAssisted(true)}>Текстовый вариант последовательности (практика с подсказкой)</summary><p>{instance.digits?.join(' → ')}</p></details>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------ go/no-go ------------------------------ */
  if (instance.kind === 'gonogo') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const grid = instance.grid ?? [];
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 340, margin: '0 auto 16px' }}>
          {grid.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cell ${c.color} signal-cell${picked.includes(i) ? ' picked' : ''}`}
              aria-label={`Сигнал ${i + 1}: ${colorName(c.color)}`}
              aria-pressed={picked.includes(i)}
              onClick={() => toggle(i)}
            >
              <span>{colorName(c.color)}</span>{picked.includes(i) && <strong aria-hidden="true"> ✓</strong>}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => submit({ targets: picked })}>
          Готово
        </button>
      </div>
    );
  }

  /* ------------------------------ план ------------------------------ */
  if (instance.kind === 'order') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const steps = instance.steps ?? [];
    return <div>
      <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
      <div className="order-board" aria-label="Карточки действий">
        {steps.map((label, i) => {
          const number = picked.indexOf(i) + 1;
          return <button key={i} type="button" className={`order-card${number ? ' selected' : ''}`} aria-pressed={number > 0} onClick={() => toggle(i)}>
            <span className="order-number" aria-hidden="true">{number || '＋'}</span><span>{label}</span>
            {number > 0 && <span className="sr-only">, шаг {number}</span>}
          </button>;
        })}
      </div>
      <p className="muted" aria-live="polite">Выбрано {picked.length} из {steps.length}. Нажми выбранную карточку ещё раз, чтобы убрать её из плана.</p>
      {picked.length > 0 && <section className="plan-preview" aria-label="Твой план">
        <h3>Твой план</h3>
        <ol>{picked.map((card, position) => <li key={card}>
          <span>{steps[card]}</span>
          <span className="plan-controls">
            <button type="button" disabled={position === 0} aria-label={`Поднять шаг «${steps[card]}»`} onClick={() => updatePicked(prev => moveSelection(prev, position, -1))}>↑</button>
            <button type="button" disabled={position === picked.length - 1} aria-label={`Опустить шаг «${steps[card]}»`} onClick={() => updatePicked(prev => moveSelection(prev, position, 1))}>↓</button>
          </span>
        </li>)}</ol>
      </section>}
      {picked.length > 0 && <button type="button" className="btn ghost" onClick={() => updatePicked(() => [])}>Очистить план</button>}
      <button type="button" className="btn" disabled={picked.length !== steps.length || !steps.length} onClick={() => submit({ cells: picked })}>Проверить план</button>
    </div>;
  }

  /* ---------------------------- поиск отличий ---------------------------- */
  if (instance.kind === 'finddiff') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const cols = instance.cols ?? 4;
    return (
      <div>
        <TaskHead instance={instance} resumedPractice={resumedPractice} selectionRestored={selectionRestored} />
        {instance.targetCard && <div className="match-sample" role="group" aria-label={`Образец: ${cardName(instance.targetCard.shape, instance.targetCard.color)}`}>
          <span>Образец</span><Shape shape={instance.targetCard.shape} color={instance.targetCard.color} size={46} />
          <strong>{cardName(instance.targetCard.shape, instance.targetCard.color)}</strong>
        </div>}
        <div className="grid cells" style={{ ['--cols' as string]: cols }}>
          {instance.cards?.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cell shape-cell${picked.includes(i) ? ' picked' : ''}`}
              aria-label={`${positionName(i, cols)}: ${cardName(c.shape, c.color)}`}
              aria-pressed={picked.includes(i)}
              onClick={() => toggle(i)}
            >
              <Shape shape={c.shape} color={c.color} size={40} />
              {picked.includes(i) && <span className="shape-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
        <p className="muted" aria-live="polite" style={{ textAlign: 'center' }}>
          Отмечено: {picked.length}. Нажми ещё раз, чтобы снять отметку.
        </p>
        {picked.length > 0 && <button type="button" className="btn ghost" onClick={() => updatePicked(() => [])}>Снять все отметки</button>}
        <button type="button" className="btn" onClick={() => submit({ cells: picked })}>
          Готово
        </button>
      </div>
    );
  }

  return null;
}

function TaskHead({ instance, resumedPractice, selectionRestored }: { instance: TaskInstance; resumedPractice: boolean; selectionRestored: boolean }) {
  return (
    <div>
      <div className="task-head">
        <span className="chip">{SKILL_LABEL[instance.skill] ?? instance.skill}</span>
        <span className="chip">{instance.title}</span>
      </div>
      <h2>{instance.prompt}</h2>
      {resumedPractice && <p role="status" className="muted">Ты вернулся к заданию. Это практика: сложность навыка не изменится.</p>}
      {selectionRestored && <p role="status" className="muted">Твои отметки восстановлены в этой вкладке.</p>}
      <ReadAloud text={`${instance.title}. ${instance.prompt}`} />
      {instance.hint && (
        <p className="muted" style={{ marginBottom: 10 }}>
          {instance.hint}
        </p>
      )}
    </div>
  );
}
