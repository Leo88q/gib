'use client';

import type { ReactNode } from 'react';
import { exercisePanelTitle, type TaskKind } from '@/lib/exercise/mechanics';
import { itemArt } from '@/lib/design/tokens';
import type { AgeBand } from '@/lib/types';
import ReadAloud from './ReadAloud';

function exerciseItemArt(kind: TaskKind): string {
  switch (kind) {
    case 'cards':
    case 'switch-rounds':
      return itemArt('cards');
    case 'memory':
    case 'symbol-memory':
    case 'digits':
      return itemArt('notebook');
    case 'gonogo':
      return itemArt('hourglass');
    case 'order':
      return itemArt('block');
    case 'social-practice':
      return itemArt('bubble');
    case 'finddiff':
    case 'choice':
    default:
      return itemArt('shapes');
  }
}

/**
 * Окно упражнения: заголовок, инструкция по возрасту, озвучивание и отмена.
 * Это визуальная рамка существующего задания; ответ, награда и проверка
 * остаются на сервере и не меняются.
 */
export default function ExerciseFrame({
  kind,
  band,
  instruction,
  spoken,
  children,
  onUndo,
  undoLabel = 'Отменить последний шаг',
  undoDisabled = true,
  status,
  progress,
}: {
  kind: TaskKind;
  band: AgeBand;
  instruction: string;
  spoken?: string;
  children: ReactNode;
  onUndo?: () => void;
  undoLabel?: string;
  undoDisabled?: boolean;
  status?: string;
  progress?: { done: number; total: number; label: string };
}) {
  const title = exercisePanelTitle(kind, band);
  return (
    <section className={`exercise-window band-${band}`} aria-label={title}>
      <div className="exercise-window-top">
        <span className="exercise-window-glyph" aria-hidden="true">✦</span>
        <img className="exercise-item-art" src={exerciseItemArt(kind)} alt="" width={36} height={36} decoding="async" />
        <h3 className="exercise-window-title">{title}</h3>
        <span className="exercise-window-glyph" aria-hidden="true">✦</span>
      </div>
      <p className="exercise-instruction">{instruction}</p>
      <ReadAloud text={[title, instruction, spoken].filter(Boolean).join('. ')} />
      {progress && progress.total > 0 && (
        <>
          <div className="exercise-progress" role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="exercise-progress-text" aria-live="polite">{progress.label}: {progress.done} из {progress.total}</p>
        </>
      )}
      {status && <p className="exercise-status" aria-live="polite">{status}</p>}
      <div className="exercise-stage">{children}</div>
      {onUndo && (
        <button type="button" className="btn ghost exercise-undo" disabled={undoDisabled} onClick={onUndo}>{undoLabel}</button>
      )}
    </section>
  );
}
