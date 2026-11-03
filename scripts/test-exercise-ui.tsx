import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import TaskView, { type AnswerPayload, type TaskInstance } from '../components/TaskView';
import SwitchRounds from '../components/SwitchRounds';
import { TASK_BY_ID } from '../lib/content/cognitive.ts';
import { exercisePanelTitle, taskPresentation, targetLabel } from '../lib/exercise/mechanics.ts';
import { exerciseDraftKey } from '../lib/exercise-draft.ts';
import { READING_KEY } from '../lib/reading-preferences.ts';
import type { AgeBand } from '../lib/types';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://gib.test/', pretendToBeVisual: true });
Object.assign(globalThis, {
  React, window: dom.window, document: dom.window.document,
  sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
});
let network = 0;
(globalThis as any).fetch = () => { network++; throw Error('unexpected network'); };
const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Ждёт условие (фаза показа заканчивается по таймеру, и её длину знает только компонент). */
async function waitFor(check: () => boolean, label: string, timeout = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await act(async () => { await sleep(100); });
  }
  assert.fail(`не дождались: ${label}`);
}
const boardReady = () => all<HTMLButtonElement>('.cell.theater').length > 0 && all<HTMLButtonElement>('.cell.theater').every(cell => !cell.disabled);
const all = <T extends Element>(selector: string) => [...container.querySelectorAll<T>(selector)];
const byText = (text: string) => {
  const button = all<HTMLButtonElement>('button').find(b => b.textContent?.includes(text));
  assert.ok(button, `кнопка «${text}»`);
  return button;
};
const click = async (target: HTMLElement) => { await act(async () => { target.click(); }); };
const clickText = async (text: string) => click(byText(text));
const text = () => container.textContent ?? '';
const render = async (view: React.ReactElement) => { await act(async () => { root.render(view); }); };
const unmount = async () => { await act(async () => { root.render(<></>); }); };

function instance(taskId: string, band: AgeBand, level = 2): TaskInstance {
  return TASK_BY_ID[taskId].make(level, band) as unknown as TaskInstance;
}

async function main() {
  /* -------------------- 1. окно, инструкция и возраст -------------------- */
  for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) {
    for (const [taskId, kind] of [
      ['stroop', 'choice'], ['rule-switch', 'cards'], ['go-nogo', 'gonogo'], ['find-diff', 'finddiff'],
      ['symbol-memory', 'symbol-memory'], ['digit-span', 'digits'], ['plan-order', 'order'], ['switch-rounds', 'switch-rounds'],
    ] as [string, Parameters<typeof taskPresentation>[0]][]) {
      dom.window.localStorage.setItem(READING_KEY, JSON.stringify({ font: 'standard', largeText: false, reduceMotion: true }));
      dom.window.sessionStorage.clear();
      dom.window.localStorage.clear();
      const view = instance(taskId, band);
      let sent: AnswerPayload | null = null;
      await render(<TaskView key={`${taskId}-${band}`} instance={view} band={band} profileId="p" sessionId="s" step={0} onAnswer={payload => { sent = payload; }} />);
      const expected = taskPresentation(kind, band);
      assert.ok(text().includes(exercisePanelTitle(kind, band)), `${taskId}/${band}: заголовок окна`);
      assert.ok(text().includes(expected.instruction), `${taskId}/${band}: инструкция возраста`);
      assert.ok(all('.exercise-window').length === 1, `${taskId}/${band}: одно окно упражнения`);
      assert.ok(!/пропустить задание|пропустить упражнение/i.test(text()), `${taskId}/${band}: когнитивное задание не изображает пропуск`);
      if (kind === 'symbol-memory' || kind === 'memory') assert.ok(all('[data-cell]').length > 0, `${taskId}/${band}: игровое поле с целями`);
      if (kind === 'choice') assert.ok(all('.options button').length > 0, `${taskId}/${band}: варианты как цели`);
      if (kind === 'cards') assert.ok(all('.card-shape').length > 0, `${taskId}/${band}: карточки как цели`);
      if (kind === 'gonogo') assert.ok(all('.signal-cell').length > 0, `${taskId}/${band}: сигналы`);
      if (kind === 'finddiff') assert.ok(all('.shape-cell').length > 0, `${taskId}/${band}: сетка фигур`);
      if (kind === 'order') assert.ok(all('.order-card').length > 0, `${taskId}/${band}: карточки плана`);
      if (kind === 'digits') assert.ok(all('.keypad .key').length === 0 || all('.digit-display').length > 0, `${taskId}/${band}: поле ввода`);
      assert.ok(all('.exercise-window .read-aloud button').length <= 1, `${taskId}/${band}: одна кнопка озвучки`);
      assert.equal(sent, null, `${taskId}/${band}: ничего не отправлено без действия`);
    }
  }

  /* ------------------ 2. одиночный выбор и его черновик ------------------ */
  dom.window.sessionStorage.clear();
  const choice = instance('stroop', '8-10');
  let sent: AnswerPayload | null = null;
  const onAnswer = (payload: AnswerPayload) => { sent = payload; };
  await render(<TaskView key="c1" instance={choice} band="8-10" profileId="p" sessionId="s" step={3} onAnswer={onAnswer} />);
  const radios = all<HTMLButtonElement>('.options [role="radio"]');
  assert.equal(radios.length, choice.options!.length);
  await click(radios[1]);
  assert.equal(radios[1].getAttribute('aria-checked'), 'true');
  assert.ok(text().includes(`Выбрано: ${choice.options![1].label}`));
  const singleKey = exerciseDraftKey('p', 's', 3, 'single');
  assert.ok(dom.window.sessionStorage.getItem(singleKey)?.includes('"pick":1'), 'выбор сохранён как черновик');
  await unmount();
  await render(<TaskView key="c2" instance={choice} band="8-10" profileId="p" sessionId="s" step={3} onAnswer={onAnswer} />);
  assert.ok(text().includes('Твой выбор восстановлен после перезагрузки'), 'выбор восстановлен после перезагрузки');
  assert.equal(all<HTMLButtonElement>('.options [role="radio"]')[1].getAttribute('aria-checked'), 'true');
  await clickText('Подтвердить выбор');
  assert.deepEqual(sent, { index: 1 }, 'отправляется тот же контракт ответа');
  assert.equal(network, 0);

  /* ---------------------- 3. карточки и правило ---------------------- */
  dom.window.sessionStorage.clear();
  const cards = instance('rule-switch', '5-7');
  sent = null;
  await render(<TaskView key="cards" instance={cards} band="5-7" profileId="p" sessionId="s" step={0} onAnswer={onAnswer} />);
  assert.ok(text().includes('Правило:'));
  await click(all<HTMLButtonElement>('.card-shape')[2]);
  assert.equal(all<HTMLButtonElement>('.card-shape')[2].getAttribute('aria-pressed'), 'true');
  await clickText('Подтвердить выбор');
  assert.deepEqual(sent, { index: 2 });

  /* ------------------- 4. сигналы и отмена отметки ------------------- */
  dom.window.sessionStorage.clear();
  const signals = instance('go-nogo', '8-10');
  sent = null;
  await render(<TaskView key="g" instance={signals} band="8-10" profileId="p" sessionId="s" step={0} onAnswer={onAnswer} />);
  const signalButtons = all<HTMLButtonElement>('.signal-cell');
  await click(signalButtons[0]);
  await click(signalButtons[4]);
  assert.ok(text().includes('Отмечено: 2'));
  await clickText('Снять последнюю отметку');
  assert.equal(signalButtons[4].getAttribute('aria-pressed'), 'false');
  await clickText('Готово');
  assert.deepEqual(sent, { targets: [0] });

  /* ----------------- 5. отличия: снятие одиночной отметки ----------------- */
  dom.window.sessionStorage.clear();
  const diff = instance('find-diff', '11-13');
  sent = null;
  await render(<TaskView key="d" instance={diff} band="11-13" profileId="p" sessionId="s" step={1} onAnswer={onAnswer} />);
  const shapeCells = all<HTMLButtonElement>('.shape-cell');
  await click(shapeCells[1]);
  await click(shapeCells[1]);
  assert.equal(shapeCells[1].getAttribute('aria-pressed'), 'false');
  await click(shapeCells[2]);
  await clickText('Готово');
  assert.deepEqual(sent, { cells: [2] });

  /* -------------------- 6. план: порядок, стрелки, черновик -------------------- */
  dom.window.sessionStorage.clear();
  const plan = instance('plan-order', '8-10');
  sent = null;
  await render(<TaskView key="o" instance={plan} band="8-10" profileId="p" sessionId="s" step={2} onAnswer={onAnswer} />);
  const orderCards = all<HTMLButtonElement>('.order-card');
  for (let i = 0; i < plan.steps!.length; i++) await click(orderCards[i]);
  assert.ok(text().includes(`Выбрано ${plan.steps!.length} из ${plan.steps!.length}`));
  const up = all<HTMLButtonElement>('.plan-controls button')[2];
  await click(up);
  const draftKeyForStep = [...Array(dom.window.sessionStorage.length).keys()]
    .map(i => dom.window.sessionStorage.key(i)!)
    .find(key => key.includes(':2') && key.includes('selection-draft'))!;
  assert.ok(dom.window.sessionStorage.getItem(draftKeyForStep)?.includes('"picked"'), 'порядок шагов сохранён');
  await unmount();
  await render(<TaskView key="o2" instance={plan} band="8-10" profileId="p" sessionId="s" step={2} onAnswer={onAnswer} />);
  assert.ok(text().includes('Твои шаги восстановлены в этой вкладке.'));
  const restoredOrder = all<HTMLButtonElement>('.order-card').map(card => card.getAttribute('aria-pressed'));
  assert.ok(restoredOrder.every(value => value === 'true'), 'все шаги восстановлены');
  await clickText('Проверить план');
  const sentPlan = sent as AnswerPayload | null;
  assert.ok(sentPlan && Array.isArray(sentPlan.cells), 'отправлен ответ плана');
  assert.equal(sentPlan.cells!.length, plan.steps!.length, 'в плане все шаги');
  assert.notDeepEqual(sentPlan.cells, plan.steps!.map((_, i) => i), 'изменённый порядок отличается от исходного');

  /* ------------------- 7. память: уменьшение движения ------------------- */
  dom.window.localStorage.setItem(READING_KEY, JSON.stringify({ font: 'standard', largeText: false, reduceMotion: true }));
  dom.window.sessionStorage.clear();
  const memory = instance('memory-grid', '5-7');
  sent = null;
  await render(<TaskView key="m" instance={memory} band="5-7" profileId="p" sessionId="s" step={1} onAnswer={onAnswer} />);
  assert.ok(all('.memory-stage.big-targets').length === 1, 'младшим — крупные цели');
  assert.equal(all('.cell.lit').length, memory.cells!.length, 'без движения последовательность видна целиком, без вспышек');
  assert.ok(text().includes('Смотри на подсвеченные клетки'));
  await waitFor(() => all('.cell.lit').length === 0 && !all<HTMLButtonElement>('.cell.theater')[0].disabled, 'статический показ завершается');
  const cells = all<HTMLButtonElement>('.cell.theater');
  assert.equal(cells.length, 9, 'поле 3×3 для 5–7');
  assert.ok(cells[0].getAttribute('aria-label')!.startsWith(targetLabel(0, 3, '5-7')), 'подпись клетки по возрасту');
  for (const index of memory.cells!) await click(cells[index]);
  assert.ok(text().includes(`Осталось: 0`));
  await clickText('Отменить последний шаг');
  assert.equal(all('.memory-badge').length, memory.cells!.length - 1);
  await click(cells[memory.cells![memory.cells!.length - 1]]);
  await clickText('Готово');
  assert.deepEqual(sent, { cells: memory.cells });

  /* ---------- 8. клавиатура: стрелки, выбор, Backspace в сетке ---------- */
  dom.window.sessionStorage.clear();
  dom.window.localStorage.clear();
  const teen = instance('symbol-memory', '11-13');
  sent = null;
  await render(<TaskView key="k" instance={teen} band="11-13" profileId="p" sessionId="s" step={1} onAnswer={onAnswer} />);
  await waitFor(boardReady, 'показ цепочки значков закончился');
  const grid = all<HTMLButtonElement>('.cell.theater');
  assert.equal(all('.big-targets').length, 0, 'старшим не нужны крупные цели');
  grid[0].focus();
  await act(async () => { grid[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  assert.ok(dom.window.document.activeElement === grid[1], 'стрелка вправо переводит фокус');
  await act(async () => { grid[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  assert.ok(dom.window.document.activeElement === grid[1 + teen.cols!], 'стрелка вниз переводит на ряд ниже');
  await click(grid[0]);
  await click(grid[1]);
  await act(async () => { grid[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); });
  assert.equal(all('.memory-badge').length, 1, 'Backspace отменяет последний шаг');
  assert.ok(all<HTMLButtonElement>('.cell.theater')[0].getAttribute('aria-pressed') === 'true', 'первая отметка осталась');
  // После отмены в поле меньше шагов, чем нужно заданию: кнопка ответа ждёт.
  const doneButton = byText('Готово');
  if ((teen.cells?.length ?? 0) > 1) assert.equal(doneButton.disabled, true, 'неполная последовательность не отправляется');
  // Добираем оставшиеся шаги другими клетками — порядок отметок восстанавливается из поля.
  const sequence = all<HTMLButtonElement>('.cell.theater')
    .map((cell, index) => (cell.getAttribute('aria-pressed') === 'true' ? index : -1))
    .filter(index => index >= 0);
  for (let index = 0; index < grid.length && sequence.length < (teen.cells?.length ?? 0); index++) {
    if (!sequence.includes(index)) { await click(grid[index]); sequence.push(index); }
  }
  assert.equal(doneButton.disabled, false, 'полная последовательность отправляется');
  await clickText('Готово');
  assert.deepEqual(sent, { cells: sequence }, 'отправлен выбранный порядок клеток');

  /* ---------------- 9. цифры: клавиатура и восстановление ---------------- */
  dom.window.localStorage.setItem(READING_KEY, JSON.stringify({ font: 'standard', largeText: false, reduceMotion: true }));
  dom.window.sessionStorage.clear();
  const digits = instance('digit-span', '8-10');
  sent = null;
  await render(<TaskView key="d1" instance={digits} band="8-10" profileId="p" sessionId="s" step={4} onAnswer={onAnswer} />);
  await waitFor(() => all('.digit-display.typing').length === 1, 'ввод цифр открылся');
  const keypad = all<HTMLButtonElement>('.keypad .key');
  assert.equal(keypad.length, 12, 'цифры, стирание и проверка');
  const display = all<HTMLElement>('.digit-display')[0];
  await click(keypad[0]); await click(keypad[1]);
  const typed = dom.window.sessionStorage.getItem(exerciseDraftKey('p', 's', 4, 'digits'));
  assert.ok(typed?.includes('"digits":"12"'), 'частичный ввод сохранён');
  await act(async () => { display.focus(); display.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '3', bubbles: true })); });
  await act(async () => { display.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); });
  await unmount();
  await render(<TaskView key="d2" instance={digits} band="8-10" profileId="p" sessionId="s" step={4} onAnswer={onAnswer} />);
  await waitFor(() => all('.digit-display.typing').length === 1, 'ввод цифр открылся после перезагрузки');
  assert.ok(text().includes('Твой выбор восстановлен после перезагрузки'));
  const slots = all('.digit-slot').map(slot => slot.textContent).join('');
  assert.equal(slots, '12' + '•'.repeat(digits.digits!.length - 2), 'ввод восстановлен по позициям');
  const submitDigits = byText('Проверить');
  assert.equal(submitDigits.disabled, true, 'неполный ввод не отправляется');
  const rest = digits.digits!.slice(2);
  for (const digit of rest) await click(all<HTMLButtonElement>('.keypad .key').find(key => key.textContent === String(digit))!);
  assert.equal(byText('Проверить').disabled, false, 'полный ввод отправляется');
  await clickText('Проверить');
  assert.deepEqual(sent, { digits: '12' + rest }, 'отправлены восстановленные цифры и добраны остальные');

  /* -------------- 10. повтор показа становится «практикой» -------------- */
  dom.window.sessionStorage.clear();
  const recall = instance('memory-grid', '11-13');
  sent = null;
  await render(<TaskView key="p1" instance={recall} band="11-13" profileId="p" sessionId="s" step={0} onAnswer={onAnswer} />);
  await waitFor(boardReady, 'показ памяти закончился');
  assert.ok(byText('Посмотреть ещё раз').textContent!.includes('(практика)'), 'старшим повтор сразу помечается как практика');
  assert.ok(!text().includes('Это будет практика'), 'до повтора нет предупреждения о практике');
  await clickText('Посмотреть ещё раз');
  await waitFor(boardReady, 'повторный показ закончился');
  const recallCells = all<HTMLButtonElement>('.cell.theater');
  for (const index of recall.cells!) await click(recallCells[index]);
  await clickText('Готово');
  assert.deepEqual(sent, { cells: recall.cells, assisted: true }, 'повтор отмечен как помощь и не меняет сложность');

  /* ------------ 11. младшие: лимит повторов мягче ------------- */
  dom.window.sessionStorage.clear();
  sent = null;
  const youngRecall = instance('memory-grid', '5-7');
  const replayLabel = () => byText('Посмотреть ещё раз').textContent ?? '';
  await render(<TaskView key="y1" instance={youngRecall} band="5-7" profileId="p" sessionId="s" step={0} onAnswer={onAnswer} />);
  await waitFor(boardReady, 'показ памяти у младших закончился');
  assert.ok(!replayLabel().includes('(практика)'), 'первый повтор младших бесплатный');
  await clickText('Посмотреть ещё раз');
  await waitFor(boardReady, 'второй показ младших закончился');
  assert.ok(!replayLabel().includes('(практика)'), 'второй повтор младших ещё бесплатный');
  await clickText('Посмотреть ещё раз');
  await waitFor(boardReady, 'третий показ младших закончился');
  assert.ok(replayLabel().includes('(практика)'), 'после двух бесплатных повторов следующий уже практика');
  const youngCells = all<HTMLButtonElement>('.cell.theater');
  for (const index of youngRecall.cells!) await click(youngCells[index]);
  await clickText('Готово');
  assert.deepEqual(sent, { cells: youngRecall.cells, assisted: true }, 'повтор сверх лимита помечает ответ как практику и не меняет сложность');

  /* ---------- 11b. старшие: повтор сразу практика ---------- */
  dom.window.sessionStorage.clear();
  sent = null;
  const teenRecall = instance('memory-grid', '11-13');
  await render(<TaskView key="y2" instance={teenRecall} band="11-13" profileId="p" sessionId="s" step={0} onAnswer={onAnswer} />);
  await waitFor(boardReady, 'показ памяти у старших закончился');
  assert.ok(replayLabel().includes('(практика)'), 'старшим повтор сразу помечен как практика');
  await clickText('Посмотреть ещё раз');
  await waitFor(boardReady, 'повтор у старших закончился');
  const teenCells = all<HTMLButtonElement>('.cell.theater');
  for (const index of teenRecall.cells!) await click(teenCells[index]);
  await clickText('Готово');
  assert.deepEqual(sent, { cells: teenRecall.cells, assisted: true }, 'старшим повтор всегда практика');

  /* ------------------- 12. SwitchRounds с возрастом ------------------- */
  dom.window.sessionStorage.clear();
  let switchCells: number[] | null = null;
  const switchInstance = instance('switch-rounds', '5-7');
  await render(<SwitchRounds cards={switchInstance.cards!} rules={switchInstance.rules!} band="5-7" draftKey="switch-draft" onSubmit={cells => { switchCells = cells; }} />);
  assert.ok(text().includes(taskPresentation('switch-rounds', '5-7').instruction));
  assert.ok(text().includes(`Раунд 1 из ${switchInstance.rules!.length}`));
  for (let round = 0; round < switchInstance.rules!.length; round++) {
    await click(all<HTMLButtonElement>('.card-shape')[round % 4]);
    await clickText(round === switchInstance.rules!.length - 1 ? 'Проверить ответы' : 'Следующее правило');
  }
  const sentRounds = switchCells as number[] | null;
  assert.ok(sentRounds && sentRounds.length === switchInstance.rules!.length, 'смена правил отправляет ответы раундов');
  assert.ok(dom.window.sessionStorage.getItem('switch-draft')?.includes('"answers"'), 'черновик смены правил сохраняется');

  /* --------------------- 13. нет утечек и таймеров --------------------- */
  await unmount();
  assert.equal(network, 0, 'упражнения не ходят в сеть');
  dom.window.close();
  console.log('UI упражнений: 3 возраста × 8 видов, окно и инструкция, черновики выбора/цифр/плана, клавиатура и отмена, уменьшение движения, лимит повторов и SwitchRounds');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
