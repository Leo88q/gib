'use client';

import { useEffect, useRef, useState } from 'react';
import { bubbleWavePositions, bubbleWaveSize } from '@/lib/content/bubble-waves';
import { readReadingPreferences, shouldReduceMotion, READING_EVENT, READING_KEY, type ReadingPreferences } from '@/lib/reading-preferences';

/** Мини-игра на Phaser; текстовый режим доступен без canvas и клавиатурой. */
function BubbleCanvas({ onPop, onReady, onError, target, reduceMotion }: { onPop: () => void; onReady: () => void; onError: () => void; target: number; reduceMotion: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPop, onReady, onError });
  callbacks.current = { onPop, onReady, onError };

  useEffect(() => {
    let destroyed = false;
    let game: import('phaser').Game | undefined;
    void import('phaser').then(({ default: Phaser }) => {
      if (destroyed || !container.current) return;
      class BubbleScene extends Phaser.Scene {
        create() {
          const background = this.add.graphics();
          background.fillStyle(0xf5fbff).fillRect(0, 0, 360, 280);
          background.fillStyle(0xd4f1ff).fillRoundedRect(12, 12, 336, 256, 24);
          const colors = [0xffa5b3, 0x98dbef, 0xffd976, 0xbca9eb, 0xa8dfad, 0xffb99a, 0x89cfdf, 0xf5b5dd];
          const coordinates = [[60, 70], [180, 70], [300, 70], [60, 190], [180, 190], [300, 190]];
          let poppedTotal = 0;
          const spawnWave = () => {
            const count = bubbleWaveSize(target - poppedTotal);
            let waveRemaining = count;
            const groups: import('phaser').GameObjects.Container[] = [];
            bubbleWavePositions(count).forEach((position, i) => {
              const [x, y] = coordinates[position];
              const group = this.add.container(x, y);
              groups.push(group);
              const bubble = this.add.circle(0, 0, 32, colors[(poppedTotal + i) % colors.length]).setStrokeStyle(3, 0x252139);
              const highlight = this.add.ellipse(-10, -12, 15, 8, 0xffffff, 0.8).setAngle(-35);
              const star = this.add.text(0, 0, '✦', { fontFamily: 'sans-serif', fontSize: '29px', color: '#b0782e' }).setOrigin(0.5).setVisible(false);
              group.add([bubble, highlight, star]);
              bubble.setInteractive({ useHandCursor: true });
              bubble.once('pointerdown', () => {
                bubble.disableInteractive();
                bubble.setFillStyle(0xfff3d1).setStrokeStyle(2, 0xb48238, 0.8);
                highlight.setVisible(false); star.setVisible(true);
                this.tweens.killTweensOf(group); group.y = y;
                if (!reduceMotion) this.tweens.add({ targets: group, scale: 1.15, duration: 120, yoyo: true });
                poppedTotal++; waveRemaining--;
                callbacks.current.onPop();
                if (waveRemaining === 0 && poppedTotal < target) {
                  this.time.delayedCall(reduceMotion ? 0 : 300, () => { groups.forEach(g => g.destroy()); spawnWave(); });
                }
              });
              if (!reduceMotion) this.tweens.add({ targets: group, y: y - 6, duration: 1100 + i * 60, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            });
          };
          spawnWave();
          callbacks.current.onReady();
        }
      }
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container.current,
        width: 360,
        height: 280,
        backgroundColor: '#f5fbff',
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 360, height: 280 },
        scene: BubbleScene,
        audio: { noAudio: true },
        render: { antialias: true },
      });
    }).catch(() => { if (!destroyed) callbacks.current.onError(); });
    return () => { destroyed = true; game?.destroy(true); };
  }, [target, reduceMotion]);

  return <div ref={container} className="bubble-canvas" aria-hidden="true" />;
}

export default function BubbleGame({ target = 8 }: { target?: 6 | 8 | 10 }) {
  const [mode, setMode] = useState<'canvas' | 'buttons'>('canvas');
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let preference = readReadingPreferences().reduceMotion;
    const update = () => setReduceMotion(shouldReduceMotion(preference, Boolean(media?.matches)));
    const changed = (event: Event) => { preference = (event as CustomEvent<ReadingPreferences | undefined>).detail?.reduceMotion === true; update(); };
    const storage = (event: StorageEvent) => { if (event.key === READING_KEY || event.key === null) { preference = readReadingPreferences().reduceMotion; update(); } };
    update();
    window.addEventListener(READING_EVENT, changed);
    window.addEventListener('storage', storage);
    media?.addEventListener?.('change', update);
    return () => { window.removeEventListener(READING_EVENT, changed); window.removeEventListener('storage', storage); media?.removeEventListener?.('change', update); };
  }, []);
  const [popped, setPopped] = useState<number[]>([]);
  const [count, setCount] = useState(0);
  const [round, setRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reset = () => { setPopped([]); setCount(0); setRound(n => n + 1); setLoading(true); setError(false); };
  const changeMode = (value: 'canvas' | 'buttons') => { setMode(value); reset(); };
  // Phaser needs a fresh scene when its animation mode changes.
  useEffect(() => { reset(); }, [reduceMotion]);
  return <div className="support-game">
    <h3>Пузырьковая поляна</h3>
    <p>Лопни пузырьки в любом порядке. Они появляются небольшими группами; торопиться не нужно!</p>
    <div className="bubble-mode" role="group" aria-label="Способ игры">
      <button type="button" aria-pressed={mode === 'canvas'} onClick={() => changeMode('canvas')}>Игровое поле</button>
      <button type="button" aria-pressed={mode === 'buttons'} onClick={() => changeMode('buttons')}>Кнопки и клавиатура</button>
    </div>
    {mode === 'canvas' ? <>
      <BubbleCanvas key={round} target={target} reduceMotion={reduceMotion} onPop={() => setCount(n => Math.min(n + 1, target))} onReady={() => setLoading(false)} onError={() => { setLoading(false); setError(true); }} />
      {loading && <p role="status">Готовим игровое поле…</p>}
      {error && <p role="alert">Поле не загрузилось. Выбери режим «Кнопки и клавиатура».</p>}
      <p className="muted">Для управления клавиатурой или программой чтения экрана выбери режим «Кнопки и клавиатура».</p>
    </> : <div className="bubble-grid">{Array.from({ length: target }, (_, i) => <button type="button" key={i} className={'bubble' + (popped.includes(i) ? ' popped' : '')} aria-label={popped.includes(i) ? `Пузырёк ${i + 1} лопнул` : `Лопнуть пузырёк ${i + 1}`} disabled={popped.includes(i)} onClick={() => { setPopped(previous => [...previous, i]); setCount(n => n + 1); }}>{popped.includes(i) ? '✦' : '🫧'}</button>)}</div>}
    <p aria-live="polite">{count === target ? 'Поляна сверкает! Можно поиграть ещё раз.' : `Открыто пузырьков: ${count} из ${target}`}</p>
    {count === target && <button className="btn" type="button" onClick={reset}>Ещё раз</button>}
  </div>;
}
