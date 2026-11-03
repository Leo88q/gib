'use client';
import { useEffect, useRef, useState } from 'react';
import { BLOCK_STEPS, checkBlockOrder } from '@/lib/content/block-puzzles';

/** Без выполнения кода: проверяем только последовательность выбранных блоков. */
function BlocklyBoard({ onWorkspace, onFailure }: { onWorkspace: (workspace: import('blockly').WorkspaceSvg | null) => void; onFailure: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onWorkspace, onFailure });
  callbacks.current = { onWorkspace, onFailure };
  useEffect(() => {
    let disposed = false;
    let workspace: import('blockly').WorkspaceSvg | undefined;
    let observer: ResizeObserver | undefined;
    void Promise.all([import('blockly'), import('blockly/msg/ru')]).then(([Blockly, messages]) => {
      if (disposed || !element.current) return;
      Blockly.setLocale(Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
      for (const step of BLOCK_STEPS) {
        if (!Blockly.Blocks[step.type]) Blockly.defineBlocksWithJsonArray([{
          type: step.type, message0: step.label, previousStatement: null, nextStatement: null, colour: step.color,
          tooltip: step.label,
        }]);
      }
      workspace = Blockly.inject(element.current, { trashcan: false, sounds: false, scrollbars: true, zoom: { controls: true, wheel: false, startScale: 0.9 }, move: { scrollbars: true, drag: true, wheel: true } });
      BLOCK_STEPS.forEach((step, i) => {
        const block = workspace!.newBlock(step.type);
        block.initSvg(); block.render(); block.moveBy(24, 20 + i * 72);
      });
      Blockly.svgResize(workspace);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { if (workspace) Blockly.svgResize(workspace); });
        observer.observe(element.current);
      }
      callbacks.current.onWorkspace(workspace);
    }).catch(() => { if (!disposed) callbacks.current.onFailure(); });
    return () => { disposed = true; observer?.disconnect(); callbacks.current.onWorkspace(null); workspace?.dispose(); };
  }, []);
  return <div ref={element} className="blockly-board" aria-label="Поле блоков. Альтернативный режим с кнопками находится выше." />;
}

export default function BlockPuzzle() {
  const [mode, setMode] = useState<'blocks' | 'buttons'>('blocks');
  const [workspace, setWorkspace] = useState<import('blockly').WorkspaceSvg | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const check = () => {
    let steps = order;
    if (mode === 'blocks') {
      if (!workspace) { setMessage('Поле ещё загружается.'); return; }
      const tops = workspace.getTopBlocks(false);
      if (tops.length !== 1) { setMessage('Соедини все три блока в одну цепочку.'); return; }
      steps = [];
      let block: import('blockly').Block | null = tops[0];
      while (block) { steps.push(block.type); block = block.getNextBlock(); }
    }
    setMessage(checkBlockOrder(steps) ? 'Получилось! Сначала пауза, потом слушаем и вместе обсуждаем решение.' : 'Попробуй ещё: сначала пауза, затем выслушай друга, а после обсуди решение.');
  };
  return <div className="support-game">
    <h3>План команды</h3>
    <p>Помоги Лису собрать план: сначала сделай паузу, затем выслушай друга, после обсудите решение.</p>
    <div className="bubble-mode" role="group" aria-label="Способ игры">
      <button type="button" aria-pressed={mode === 'blocks'} onClick={() => { setMode('blocks'); setMessage(''); }}>Перетаскивать блоки</button>
      <button type="button" aria-pressed={mode === 'buttons'} onClick={() => { setMode('buttons'); setMessage(''); }}>Собирать кнопками</button>
    </div>
    {mode === 'blocks' ? <><p className="muted">Перетащи блоки и соедини их сверху вниз. Можно переключиться на кнопки.</p><BlocklyBoard onWorkspace={setWorkspace} onFailure={() => setFailed(true)} />{failed && <p role="alert">Поле не загрузилось. Выбери «Собирать кнопками».</p>}</> : <>
      <p>Нажимай шаги по порядку.</p>
      <div className="options">{BLOCK_STEPS.map(step => <button className="option" type="button" key={step.type} disabled={order.includes(step.type)} onClick={() => { setOrder(o => [...o, step.type]); setMessage(''); }}>{step.label}</button>)}</div>
      <p aria-live="polite">План: {order.length ? order.map(type => BLOCK_STEPS.find(step => step.type === type)?.label).join(' → ') : 'пока пуст'}</p>
      <button type="button" className="story-restart" onClick={() => { setOrder([]); setMessage(''); }}>Очистить план</button>
    </>}
    <button type="button" className="btn" onClick={check}>Проверить план</button>
    {message && <p aria-live="polite">{message}</p>}
  </div>;
}
