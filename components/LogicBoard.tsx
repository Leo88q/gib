'use client';
import { useState } from 'react';
import type { LogicBoard as Board } from '@/lib/content/logic-puzzles';

export default function LogicBoard({ board, onPractice }: { board: Board; onPractice: () => void }) {
  const [marked, setMarked] = useState<string[]>([]);
  const toggle = (id: string) => {
    onPractice();
    setMarked(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  };
  return <div className="logic-board">
    <div className="logic-tiles" aria-label={board.mode === 'sequence' ? `Ряд: ${board.values.join(', ')}, следующее число неизвестно` : `Числа задания: ${board.values.join(', ')}`}>
      {board.values.map((value, i) => <span className="logic-tile" key={i} aria-hidden="true">{value}</span>)}
      {board.mode === 'sequence' && <span className="logic-tile mystery" aria-hidden="true">?</span>}
    </div>
    {board.counters && <div className="logic-counter">
      <p>Можно отмечать монетки для счёта. Это будет практика.</p>
      {board.counters.map((count, group) => <div className="coin-group" key={group} role="group" aria-label={group === 0 ? 'Монетки Лиса' : 'Монетки друга'}>
        <span>{group === 0 ? 'Лис' : 'Друг'}</span>
        <div>{Array.from({ length: count }, (_, i) => {
          const id = `${group}-${i}`, active = marked.includes(id);
          return <button key={id} type="button" className={`count-coin${active ? ' marked' : ''}`} aria-label={`${group === 0 ? 'Лис' : 'Друг'}, монетка ${i + 1}`} aria-pressed={active} onClick={() => toggle(id)}>{active ? '✓' : '★'}</button>;
        })}</div>
      </div>)}
      <p className="muted" aria-live="polite">Отмечено: {marked.length}</p>
      {marked.length > 0 && <button type="button" className="btn ghost" onClick={() => setMarked([])}>Снять отметки</button>}
    </div>}
  </div>;
}
