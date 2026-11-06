'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Shape, ShapeCardView } from './Shape';
import ReadAloud from './ReadAloud';
import LogicBoard from './LogicBoard';
import SwitchRounds from './SwitchRounds';
import ExerciseFrame from './ExerciseFrame';
import useReduceMotion from './useReduceMotion';
import type { LogicBoard as LogicBoardData } from '@/lib/content/logic-puzzles';
import { cardName, colorName, positionName } from '@/lib/content/visual-labels';
import { toggleSelection, moveSelection } from '@/lib/content/sequence-selection';
import { ActiveTimer } from '@/lib/active-timer';
import { parseSelectionDraft, selectionDraftKey } from '@/lib/selection-draft';
import { switchDraftKey } from '@/lib/switch-draft';
import { exerciseDraftKey, parseSingleDraft, parseDigitsDraft } from '@/lib/exercise-draft';
import { applySequenceAction, taskPresentation, targetLabel, type SequenceAction } from '@/lib/exercise/mechanics';
import type { AgeBand } from '@/lib/types';

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

const BIG_COLOR: Record<string, string> = { red: '#a3172a', blue: '#1a3f96', green: '#06603a', yellow: '#7a5100', purple: '#552a99', orange: '#8a3f00' };

/**
 * Сколько раз можно пересмотреть показ, оставаясь «без помощи».
 * Дальше повтор считается практикой: сложность навыка не меняется.
 */
const PEEK_LIMIT: Record<AgeBand, number> = { '5-7': 2, '8-10': 1, '11-13': 0 };

/** Длительность статического показа для «меньше движения»: без вспышек, но не бесконечно. */
const STATIC_SHOW_MEMORY_MS = 2600;
const STATIC_SHOW_DIGITS_MS = 3200;

export default function TaskView({
  instance,
  onAnswer,
  resumedPractice = false,
  draftKey,
  selectionKey,
  band = '8-10',
  profileId,
  sessionId,
  step = 0,
}: {
  instance: TaskInstance;
  resumedPractice?: boolean;
  draftKey?: string;
  selectionKey?: string;
  band?: AgeBand;
  profileId?: string;
  sessionId?: string;
  step?: number;
  onAnswer: (answer: AnswerPayload, ms: number) => void;
}) {
  const reduceMotion = useReduceMotion();
  const presentation = taskPresentation(instance.kind, band, reduceMotion);
  const timer = useRef(new ActiveTimer());
  const sequenceStarted = useRef(false);
  const phaseRef = useRef<'show' | 'input'>('show');
  const gridRef = useRef<HTMLDivElement>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [singlePick, setSinglePick] = useState<number | null>(null);
  const [viewRound, setViewRound] = useState(0);
  const [assisted, setAssisted] = useState(false);
  const [flashIndex, setFlashIndex] = useState(-1);
  const [phase, setPhase] = useState<'show' | 'input'>('show');
  const [digitsInput, setDigitsInput] = useState('');
  const [shownDigits, setShownDigits] = useState<number[] | null>(null);
  const [peeks, setPeeks] = useState(0);
  const [staticRequested, setStaticRequested] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [selectionRestored, setSelectionRestored] = useState(false);

  const kind = instance.kind;
  // Черновики привязаны к профилю, сессии и шагу. Родитель может передать ключи
  // явно; если нет — они выводятся из тех же данных тем же модулем.
  const derived = profileId && sessionId !== undefined ? { selection: selectionDraftKey(profileId, sessionId, step), switch: switchDraftKey(profileId, sessionId, step) } : null;
  const resolvedSelectionKey = selectionKey ?? derived?.selection;
  const resolvedDraftKey = draftKey ?? derived?.switch;
  const isMemory = kind === 'memory' || kind === 'symbol-memory';
  const isDigits = kind === 'digits';
  const singleDraftKey = profileId && sessionId !== undefined ? exerciseDraftKey(profileId, sessionId, step, 'single') : undefined;
  const digitsDraftKey = profileId && sessionId !== undefined ? exerciseDraftKey(profileId, sessionId, step, 'digits') : undefined;
  const pickCount = kind === 'choice' ? instance.options?.length ?? 0 : kind === 'cards' ? instance.cards?.length ?? 0 : 0;
  const singleSignature = JSON.stringify([instance.taskId, instance.prompt, instance.cards, instance.options]);
  const digitsSignature = JSON.stringify([instance.taskId, instance.digits]);

  const draftCount = kind === 'order' ? instance.steps?.length ?? 0 : kind === 'finddiff' ? instance.cards?.length ?? 0 : kind === 'gonogo' ? instance.grid?.length ?? 0 : 0;
  const draftSignature = JSON.stringify([instance.kind, instance.steps, instance.cards, instance.targetCard, instance.grid, instance.prompt]);

  /* ------------------- восстановление после перезагрузки ------------------- */

  useEffect(() => {
    let restored = null;
    try { if (resolvedSelectionKey && draftCount) restored = parseSelectionDraft(sessionStorage.getItem(resolvedSelectionKey), draftSignature, draftCount); } catch { /* storage is optional */ }
    if (restored?.picked.length) { setPicked(restored.picked); setSelectionRestored(true); }
    setDraftReady(true);
  }, [resolvedSelectionKey, draftSignature, draftCount]);

  useEffect(() => {
    if (!singleDraftKey || !pickCount) return;
    let saved = null;
    try { saved = parseSingleDraft(sessionStorage.getItem(singleDraftKey), singleSignature, pickCount); } catch { /* storage is optional */ }
    if (saved?.pick !== null && saved?.pick !== undefined) { setSinglePick(saved.pick); setDraftRestored(true); }
  }, [singleDraftKey, singleSignature, pickCount]);

  useEffect(() => {
    if (!digitsDraftKey || !instance.digits?.length) return;
    let saved = null;
    try { saved = parseDigitsDraft(sessionStorage.getItem(digitsDraftKey), digitsSignature, instance.digits.length); } catch { /* storage is optional */ }
    if (saved?.digits) { setDigitsInput(saved.digits); setDraftRestored(true); }
  }, [digitsDraftKey, digitsSignature, instance.digits]);

  useEffect(() => {
    if (!draftReady || !resolvedSelectionKey || !draftCount) return;
    try {
      if (picked.length) sessionStorage.setItem(resolvedSelectionKey, JSON.stringify({ signature: draftSignature, picked }));
      else sessionStorage.removeItem(resolvedSelectionKey);
    } catch { /* play remains available */ }
  }, [draftReady, resolvedSelectionKey, draftCount, draftSignature, picked]);

  useEffect(() => {
    if (!singleDraftKey || !pickCount) return;
    try {
      if (singlePick === null) sessionStorage.removeItem(singleDraftKey);
      else sessionStorage.setItem(singleDraftKey, JSON.stringify({ signature: singleSignature, pick: singlePick }));
    } catch { /* play remains available */ }
  }, [singleDraftKey, singleSignature, pickCount, singlePick]);

  useEffect(() => {
    if (!digitsDraftKey || !instance.digits?.length) return;
    try {
      if (!digitsInput) sessionStorage.removeItem(digitsDraftKey);
      else sessionStorage.setItem(digitsDraftKey, JSON.stringify({ signature: digitsSignature, digits: digitsInput }));
    } catch { /* play remains available */ }
  }, [digitsDraftKey, digitsSignature, digitsInput, instance.digits]);

  // Скрытое время не считается временем ответа. Прерванный показ начинается заново.
  useEffect(() => {
    const isVisible = () => document.visibilityState !== 'hidden';
    timer.current.reset(performance.now(), isVisible());
    const change = () => {
      const show = isVisible();
      timer.current.setVisible(show, performance.now());
      if (!show && phaseRef.current === 'show' && (isMemory || isDigits)) {
        if (sequenceStarted.current) { setAssisted(true); setInterrupted(true); }
        setViewRound(n => n + 1);
      }
      if (!show) { setFlashIndex(-1); setShownDigits(null); }
    };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, [isMemory, isDigits]);

  // Показ последовательности: вспышки по одной или статический список без анимации.
  useEffect(() => {
    if (phase !== 'show' || (!isMemory && !isDigits)) return;
    const seq = isMemory ? instance.cells : instance.digits;
    if (!seq?.length) return;
    const finish = () => {
      setStaticRequested(false);
      setShownDigits(null);
      setFlashIndex(-1);
      timer.current.reset(performance.now(), true);
      phaseRef.current = 'input';
      setPhase('input');
    };
    if (reduceMotion || staticRequested) {
      // Статический показ: без вспышек, прыжков и анимации. Нажатие по полю
      // сразу открывает ввод, поэтому ждать таймер не обязательно.
      const id = setTimeout(finish, isMemory ? STATIC_SHOW_MEMORY_MS : STATIC_SHOW_DIGITS_MS);
      return () => clearTimeout(id);
    }
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stepMs = presentation.showStepMs;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      if (i >= seq.length) {
        timers.push(setTimeout(() => { if (document.visibilityState === 'hidden') return; finish(); }, presentation.showGapMs));
        return;
      }
      sequenceStarted.current = true;
      if (isMemory) setFlashIndex(seq[i]);
      else setShownDigits([seq[i]]);
      if (isMemory) timers.push(setTimeout(() => setFlashIndex(-1), Math.round(stepMs * 0.7)));
      i += 1;
      timers.push(setTimeout(tick, stepMs));
    };
    timers.push(setTimeout(tick, Math.round(stepMs * 0.7)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMemory, isDigits, instance.cells, instance.digits, viewRound, phase, reduceMotion, staticRequested, presentation.showStepMs, presentation.showGapMs]);

  const registerPeek = () => {
    if (peeks >= PEEK_LIMIT[band]) setAssisted(true);
    setPeeks(n => n + 1);
  };

  const replay = () => {
    registerPeek();
    setPicked([]);
    setDigitsInput('');
    setFlashIndex(-1);
    setShownDigits(null);
    setStaticRequested(false);
    phaseRef.current = 'show';
    setPhase('show');
    setViewRound(n => n + 1);
  };

  const watchStatic = () => {
    registerPeek();
    setFlashIndex(-1);
    setShownDigits(null);
    setStaticRequested(true);
    phaseRef.current = 'show';
    setPhase('show');
    setViewRound(n => n + 1);
  };

  const elapsed = () => timer.current.elapsed(performance.now());
  const submit = (answer: AnswerPayload) => onAnswer(assisted ? { ...answer, assisted: true } : answer, elapsed());
  const toggle = (i: number) => setPicked(prev => toggleSelection(prev, i));

  /* ----------------------- клавиатура для сеток ----------------------- */
  const applyAction = useCallback((action: SequenceAction) => {
    if (action.type === 'undo') { setPicked(prev => prev.slice(0, -1)); return; }
    if (action.type !== 'select' && action.type !== 'move') return;
    const total = (instance.rows ?? 3) * (instance.cols ?? 3);
    setPicked(prev => applySequenceAction(prev, action, total));
  }, [instance.rows, instance.cols]);

  const gridKeyboard = (event: React.KeyboardEvent<HTMLDivElement>, total: number, cols: number) => {
    if (phase === 'show') return;
    // Клавиатура работает даже когда фокус не на отдельной клетке: отсчёт
    // идёт от первой в DOM, а стрелки двигают настоящий фокус на клетку.
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-cell]') ?? []);
    const active = document.activeElement as HTMLButtonElement | null;
    const current = active ? buttons.indexOf(active) : -1;
    const move = (delta: number) => {
      const next = Math.max(0, Math.min(total - 1, (current < 0 ? 0 : current) + delta));
      buttons[next]?.focus();
    };
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(cols); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-cols); }
    else if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); buttons[total - 1]?.focus(); }
    else if (event.key === 'Backspace') { event.preventDefault(); applyAction({ type: 'undo' }); }
  };

  const head = (
    <div className="task-head">
      <span className="chip">{SKILL_LABEL[instance.skill] ?? instance.skill}</span>
      <span className="chip">{instance.title}</span>
    </div>
  );

  const resumedNote = resumedPractice && <p role="status" className="muted">Ты вернулся к заданию. Это практика: сложность навыка не изменится.</p>;
  const restoredNotice = draftRestored && <p className="exercise-restored" role="status">Твой выбор восстановлен после перезагрузки. Его можно изменить.</p>;

  /* ------------------------------- варианты ------------------------------- */
  if (kind === 'choice') {
    const options = instance.options ?? [];
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {selectionRestored && <p role="status" className="muted">Твои отметки восстановлены в этой вкладке.</p>}
        {restoredNotice}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: singlePick === null ? 0 : 1, total: 1, label: 'Выбор' }}
        >
          {instance.bigText && (
            <div className="big-word">
              <span style={{ color: BIG_COLOR[instance.bigColor ?? ''] ?? '#252139', padding: '6px 18px', borderRadius: 14, display: 'inline-block' }}>
                {instance.bigText}
              </span>
            </div>
          )}
          {instance.logicBoard && <LogicBoard board={instance.logicBoard} onPractice={() => setAssisted(true)} />}
          <div className="options" role="radiogroup" aria-label="Варианты ответа">
            {options.map((o, i) => (
              <button
                key={o.id + i}
                type="button"
                role="radio"
                className={`option${singlePick === i ? ' scenario-selected' : ''}`}
                aria-checked={singlePick === i}
                onClick={() => setSinglePick(i)}
              >
                <span className="option-mark" aria-hidden="true">{singlePick === i ? '✓' : '○'}</span>
                <span>{o.label}</span>
                {o.color && <span className={`option-swatch ${o.color}`} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </ExerciseFrame>
        <p className="muted" aria-live="polite">{singlePick === null ? 'Выбери вариант — его можно изменить.' : `Выбрано: ${options[singlePick]?.label}`}</p>
        <button type="button" className="btn" disabled={singlePick === null} onClick={() => singlePick !== null && submit({ index: singlePick })}>Подтвердить выбор</button>
      </div>
    );
  }

  /* ------------------------- «лишняя карточка» ------------------------- */
  if (kind === 'cards') {
    const cards = instance.cards ?? [];
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {restoredNotice}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: singlePick === null ? 0 : 1, total: 1, label: 'Выбор карточки' }}
        >
          {instance.ruleLabel && <div className="rule-banner" role="note">Правило: <strong>{instance.ruleLabel}</strong></div>}
          <div className="grid card-grid" role="group" aria-label="Карточки для выбора">
            {cards.map((c, i) => (
              <ShapeCardView key={i} card={c} selected={singlePick === i} onClick={() => setSinglePick(i)} />
            ))}
          </div>
        </ExerciseFrame>
        <p className="muted" aria-live="polite">{singlePick === null ? 'Выбери карточку — её можно изменить.' : `Выбрано: ${cardName(cards[singlePick].shape, cards[singlePick].color)}`}</p>
        <button type="button" className="btn" disabled={singlePick === null} onClick={() => singlePick !== null && submit({ index: singlePick })}>Подтвердить выбор</button>
      </div>
    );
  }

  if (kind === 'switch-rounds') {
    return <div>
      {head}
      <h2>{instance.prompt}</h2>
      {resumedNote}
      <SwitchRounds cards={instance.cards ?? []} rules={instance.rules ?? []} draftKey={resolvedDraftKey} band={band} onSubmit={cells => submit({ cells })} />
    </div>;
  }

  /* ------------------------------ память ------------------------------ */
  if (isMemory) {
    const cols = instance.cols ?? 3;
    const total = (instance.rows ?? 3) * cols;
    const target = instance.cells?.length ?? 0;
    const cellName = (i: number) => instance.kind === 'symbol-memory' && instance.cards?.[i]
      ? cardName(instance.cards[i].shape, instance.cards[i].color)
      : targetLabel(i, cols, band);
    const showing = phase === 'show';
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {selectionRestored && <p role="status" className="muted">Твои отметки восстановлены в этой вкладке.</p>}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: picked.length, total: target, label: 'Повторено' }}
          onUndo={() => setPicked(prev => prev.slice(0, -1))}
          undoDisabled={showing || picked.length === 0}
          undoLabel="Отменить последний шаг"
          status={showing
            ? reduceMotion || staticRequested ? 'Смотри на подсвеченные клетки. Через несколько секунд можно будет нажимать.' : flashIndex >= 0 ? `Огонёк: ${cellName(flashIndex)}` : 'Смотри внимательно…'
            : interrupted ? 'Показ начался заново. Это будет практика.' : `Нажимай клетки по порядку. Осталось: ${Math.max(0, target - picked.length)}`}
        >
          <div
            ref={gridRef}
            className={`grid cells memory-stage${presentation.bigTargets ? ' big-targets' : ''}`}
            style={{ ['--cols' as string]: cols }}
            role="group"
            aria-label="Игровое поле"
            onKeyDown={event => gridKeyboard(event, total, cols)}
          >
            {Array.from({ length: total }, (_, i) => {
              const lit = showing && (flashIndex === i || ((reduceMotion || staticRequested) && Boolean(instance.cells?.includes(i))));
              return (
                <button
                  key={i}
                  type="button"
                  data-cell
                  className={`cell theater${instance.kind === 'symbol-memory' ? ' shape-cell' : ''}${lit ? ' lit' : ''}${picked.includes(i) ? ' picked' : ''}`}
                  disabled={showing}
                  aria-label={`${cellName(i)}${picked.includes(i) ? `, выбран под номером ${picked.indexOf(i) + 1}` : ''}`}
                  aria-pressed={picked.includes(i)}
                  onClick={() => !showing && toggle(i)}
                >
                  {instance.kind === 'symbol-memory' && instance.cards?.[i] && <Shape shape={instance.cards[i].shape} color={instance.cards[i].color} size={presentation.bigTargets ? 56 : 44} />}
                  {lit && <span className="cell-glow" aria-hidden="true">✦</span>}
                  {picked.includes(i) && <span className="memory-badge" aria-hidden="true">{picked.indexOf(i) + 1}</span>}
                </button>
              );
            })}
          </div>
        </ExerciseFrame>
        {showing ? (
          <button type="button" className="btn ghost" onClick={watchStatic}>Показать без вспышек</button>
        ) : (
          <>
            <div className="exercise-actions">
              <button type="button" className="btn" disabled={picked.length !== target} onClick={() => submit({ cells: picked })}>Готово</button>
              <button type="button" className="btn ghost" onClick={replay}>Посмотреть ещё раз{peeks >= PEEK_LIMIT[band] ? ' (практика)' : ''}</button>
            </div>
            <details className="task-help" open={reduceMotion} onToggle={e => { if (e.currentTarget.open) registerPeek(); }}>
              <summary>Список последовательности вместо вспышек (практика)</summary>
              <p>{instance.cells?.map(i => cellName(i)).join(' → ')}</p>
            </details>
            <p className="muted">{presentation.keyboardNotes}</p>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------- цифры ------------------------------- */
  if (isDigits) {
    const len = instance.digits?.length ?? 0;
    const press = (d: string) => setDigitsInput(s => (s.length < len ? s + d : s));
    const showing = phase === 'show';
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {restoredNotice}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: digitsInput.length, total: len, label: 'Введено цифр' }}
          onUndo={() => setDigitsInput(s => s.slice(0, -1))}
          undoDisabled={digitsInput.length === 0}
          undoLabel="Стереть последнюю цифру"
          status={interrupted ? 'Показ начался заново. Это будет практика.' : showing ? 'Смотри на цифры…' : undefined}
        >
          <div
            className={`digit-display${showing ? '' : ' typing'}`}
            aria-live="polite"
            onKeyDown={event => {
              if (showing) return;
              if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
              else if (event.key === 'Backspace') { event.preventDefault(); setDigitsInput(s => s.slice(0, -1)); }
            }}
            tabIndex={showing ? -1 : 0}
            role="textbox"
            aria-label={`Ввод ${len} цифр`}
          >
            {!showing
              ? digitsInput.padEnd(len, '•').split('').map((c, i) => <span key={i} className={`digit-slot${c === '•' ? ' empty' : ''}`}>{c}</span>)
              : shownDigits !== null
                ? <span className="digit-slot">{shownDigits.join(' ')}</span>
                : <span className="digit-slot empty">{'•'.repeat(len)}</span>}
          </div>
          {!showing && (
            <div className="keypad" role="group" aria-label="Клавиатура цифр">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" className="key" onClick={() => press(d)}>{d}</button>
              ))}
              <button type="button" className="key" aria-label="Удалить последнюю цифру" onClick={() => setDigitsInput(s => s.slice(0, -1))}>⌫</button>
              <button type="button" className="key" onClick={() => press('0')}>0</button>
              <button type="button" className="key wide" disabled={digitsInput.length !== len} onClick={() => submit({ digits: digitsInput })}>Проверить</button>
            </div>
          )}
        </ExerciseFrame>
        {!showing && (
          <>
            <button type="button" className="btn ghost" onClick={replay}>Посмотреть цифры ещё раз{peeks >= PEEK_LIMIT[band] ? ' (практика)' : ''}</button>
            <details className="task-help" onToggle={e => { if (e.currentTarget.open) registerPeek(); }}>
              <summary>Текстовая подсказка вместо повтора (практика)</summary>
              <p>{instance.digits?.join(' → ')}</p>
            </details>
            <p className="muted">С клавиатуры можно вводить цифры и стирать Backspace.</p>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------ go/no-go ------------------------------ */
  if (kind === 'gonogo') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const grid = instance.grid ?? [];
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {selectionRestored && <p role="status" className="muted">Твои отметки восстановлены в этой вкладке.</p>}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: picked.length, total: grid.length, label: 'Отмечено сигналов' }}
          onUndo={() => setPicked(prev => prev.slice(0, -1))}
          undoDisabled={picked.length === 0}
          undoLabel="Снять последнюю отметку"
          status={`Отмечено: ${picked.length}. Нажми на сигнал ещё раз, чтобы снять отметку.`}
        >
          <div className={`grid signals${presentation.bigTargets ? ' big-targets' : ''}`} role="group" aria-label="Сигналы района">
            {grid.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`cell signal-cell ${c.color}${picked.includes(i) ? ' picked' : ''}`}
                aria-label={`Сигнал ${i + 1}: ${colorName(c.color)}`}
                aria-pressed={picked.includes(i)}
                onClick={() => toggle(i)}
              >
                <span className="signal-lamp" aria-hidden="true" />
                <span className="signal-label">{colorName(c.color)}</span>
                {picked.includes(i) && <strong className="signal-check" aria-hidden="true">✓</strong>}
              </button>
            ))}
          </div>
        </ExerciseFrame>
        <button type="button" className="btn" onClick={() => submit({ targets: picked })}>Готово</button>
      </div>
    );
  }

  /* ------------------------------ план ------------------------------ */
  if (kind === 'order') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const steps = instance.steps ?? [];
    return <div>
      {head}
      <h2>{instance.prompt}</h2>
      {resumedNote}
      {selectionRestored && <p role="status" className="muted">Твои шаги восстановлены в этой вкладке.</p>}
      <ExerciseFrame
        kind={kind}
        band={band}
        instruction={presentation.instruction}
        spoken={instance.hint}
        progress={{ done: picked.length, total: steps.length, label: 'Шагов в плане' }}
        onUndo={() => setPicked(prev => prev.slice(0, -1))}
        undoDisabled={picked.length === 0}
        undoLabel="Убрать последний шаг"
        status={`Выбрано ${picked.length} из ${steps.length}.`}
      >
        <div className="order-board" aria-label="Карточки действий">
          {steps.map((label, i) => {
            const number = picked.indexOf(i) + 1;
            return <button
              key={i}
              type="button"
              className={`order-card${number ? ' selected' : ''}`}
              aria-pressed={number > 0}
              aria-label={`${label}${number ? `, шаг ${number} плана` : ''}`}
              onClick={() => toggle(i)}
            >
              <span className="order-number" aria-hidden="true">{number || '＋'}</span><span>{label}</span>
              {presentation.showMoveHints && number > 0 && <span className="order-drag" aria-hidden="true">⇅</span>}
            </button>;
          })}
        </div>
        {picked.length > 0 && <section className="plan-preview" aria-label="Твой план">
          <h3>Твой план</h3>
          <ol>{picked.map((card, position) => <li key={card}>
            <span>{steps[card]}</span>
            <span className="plan-controls">
              <button type="button" disabled={position === 0} aria-label={`Поднять шаг «${steps[card]}»`} onClick={() => setPicked(prev => moveSelection(prev, position, -1))}>↑</button>
              <button type="button" disabled={position === picked.length - 1} aria-label={`Опустить шаг «${steps[card]}»`} onClick={() => setPicked(prev => moveSelection(prev, position, 1))}>↓</button>
            </span>
          </li>)}</ol>
        </section>}
        {picked.length > 0 && <button type="button" className="btn ghost" onClick={() => setPicked([])}>Очистить план</button>}
      </ExerciseFrame>
      <button type="button" className="btn" disabled={picked.length !== steps.length || !steps.length} onClick={() => submit({ cells: picked })}>Проверить план</button>
      <p className="muted">{presentation.keyboardNotes}</p>
    </div>;
  }

  /* ---------------------------- поиск отличий ---------------------------- */
  if (kind === 'finddiff') {
    if (!draftReady) return <p role="status">Подготавливаем задание…</p>;
    const cols = instance.cols ?? 4;
    return (
      <div>
        {head}
        <h2>{instance.prompt}</h2>
        {resumedNote}
        {selectionRestored && <p role="status" className="muted">Твои отметки восстановлены в этой вкладке.</p>}
        <ExerciseFrame
          kind={kind}
          band={band}
          instruction={presentation.instruction}
          spoken={instance.hint}
          progress={{ done: picked.length, total: instance.cards?.length ?? 0, label: 'Отмечено фигурок' }}
          onUndo={() => setPicked(prev => prev.slice(0, -1))}
          undoDisabled={picked.length === 0}
          undoLabel="Снять последнюю отметку"
          status={`Отмечено: ${picked.length}. Нажми ещё раз, чтобы снять отметку.`}
        >
          {instance.targetCard && <div className="match-sample" role="group" aria-label={`Образец: ${cardName(instance.targetCard.shape, instance.targetCard.color)}`}>
            <span>Образец</span><Shape shape={instance.targetCard.shape} color={instance.targetCard.color} size={46} />
            <strong>{cardName(instance.targetCard.shape, instance.targetCard.color)}</strong>
          </div>}
          <div className={`grid cells${presentation.bigTargets ? ' big-targets' : ''}`} style={{ ['--cols' as string]: cols }}>
            {instance.cards?.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`cell shape-cell${picked.includes(i) ? ' picked' : ''}`}
                aria-label={`${positionName(i, cols)}: ${cardName(c.shape, c.color)}`}
                aria-pressed={picked.includes(i)}
                onClick={() => toggle(i)}
              >
                <Shape shape={c.shape} color={c.color} size={presentation.bigTargets ? 56 : 40} />
                {picked.includes(i) && <span className="shape-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </ExerciseFrame>
        {picked.length > 0 && <button type="button" className="btn ghost" onClick={() => setPicked([])}>Снять все отметки</button>}
        <button type="button" className="btn" onClick={() => submit({ cells: picked })}>Готово</button>
      </div>
    );
  }

  return null;
}
