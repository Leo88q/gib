import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import TaskView, { type TaskInstance } from '../components/TaskView';
import SwitchRounds from '../components/SwitchRounds';
import TaskViewSupport from '../components/SupportPractice';
import SupportKit from '../components/SupportKit';
import { makeSupportPractice } from '../lib/content/support-practice';
import { TASK_BY_ID } from '../lib/content/cognitive';
import type { AgeBand } from '../lib/types';

/**
 * Статическая проверка доступности разметки (без axe): имена кнопок, роли,
 * «не только цветом», фокус, живые области. Это не заменяет проверку
 * экранным диктором и реальными устройствами.
 */
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
(globalThis as any).fetch = () => { throw Error('unexpected network'); };
const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const all = <T extends Element>(selector: string) => [...container.querySelectorAll<T>(selector)];
const render = async (view: React.ReactElement) => { await act(async () => { root.render(view); }); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** У каждой кнопки есть видимое имя (текст, aria-label или aria-labelledby), а не только значок. */
function assertNamedButtons(where: string) {
  for (const button of all<HTMLButtonElement>('button')) {
    if (button.closest('.read-aloud')) continue; // у озвучки имя задано текстом кнопки
    const name = (button.textContent ?? '').trim()
      || button.getAttribute('aria-label')
      || (button.getAttribute('aria-labelledby') ? dom.window.document.getElementById(button.getAttribute('aria-labelledby')!)?.textContent : '');
    assert.ok(name && name.length > 0, `${where}: у кнопки есть доступное имя`);
    // Только эмодзи без подписи — недостаточно, если это не декоративная кнопка с aria-label.
    const onlyEmoji = /^[\p{Emoji}\p{Emoji_Presentation}\uFE0F\s]+$/u.test((button.textContent ?? '').trim());
    if (onlyEmoji) assert.ok(button.getAttribute('aria-label'), `${where}: кнопка-значок имеет aria-label`);
  }
}

/** Никакой текст не передан только цветом: у цветовых подсказок есть слово. */
function assertNotColorOnly(where: string) {
  for (const swatch of all('.option-swatch, .color-dot, .swatch')) {
    assert.equal(swatch.getAttribute('aria-hidden'), 'true', `${where}: образец цвета скрыт от диктора`);
    const label = swatch.parentElement?.textContent ?? '';
    assert.ok(label.replace(/\s/g, '').length > 0, `${where}: рядом есть словесная подпись`);
  }
}

async function main() {
  /* ------------------- 1. когнитивные задания всех видов ------------------- */
  for (const band of ['5-7', '8-10', '11-13'] as AgeBand[]) {
    for (const [taskId, expected] of [
      ['stroop', 'choice'], ['rule-switch', 'cards'], ['go-nogo', 'gonogo'], ['find-diff', 'finddiff'],
      ['symbol-memory', 'symbol-memory'], ['digit-span', 'digits'], ['plan-order', 'order'],
    ] as [string, string][]) {
      dom.window.localStorage.setItem('gib:reading:v1', JSON.stringify({ font: 'standard', largeText: false, reduceMotion: true }));
      dom.window.sessionStorage.clear();
      const instance = TASK_BY_ID[taskId].make(2, band) as unknown as TaskInstance;
      assert.equal(instance.kind, expected, `${taskId}: вид`);
      await render(<TaskView key={`${taskId}-${band}`} instance={instance} band={band} profileId="p" sessionId="s" step={0} onAnswer={() => {}} />);
      assertNamedButtons(`${taskId}/${band}`);
      assertNotColorOnly(`${taskId}/${band}`);
      // Окно задания подписано и связано с инструкцией.
      const windowEl = container.querySelector('.exercise-window');
      assert.ok(windowEl, `${taskId}/${band}: окно задания`);
      assert.ok(windowEl!.getAttribute('aria-label'), `${taskId}/${band}: у окна есть имя`);
      // Живые области объявляют изменения, но не вместо чтения задания.
      for (const live of all('[aria-live]')) {
        assert.ok(['polite', 'assertive', 'off'].includes(live.getAttribute('aria-live')!), `${taskId}/${band}: aria-live корректный`);
      }
      // Поля ввода с ролью имеют имя.
      for (const box of all('[role="textbox"]')) assert.ok(box.getAttribute('aria-label'), `${taskId}/${band}: поле ввода подписано`);
      // Группы выбора подписаны.
      for (const group of all('[role="group"], [role="radiogroup"], [role="progressbar"]')) {
        assert.ok(group.getAttribute('aria-label') || group.getAttribute('aria-labelledby'), `${taskId}/${band}: группа ${group.getAttribute('role')} подписана`);
      }
      await act(async () => { await sleep(20); });
    }
  }

  /* ------------------------ 2. смена правил и идеи ------------------------ */
  const switching = TASK_BY_ID['switch-rounds'].make(1, '8-10') as unknown as TaskInstance;
  await render(<SwitchRounds cards={switching.cards!} rules={switching.rules!} band="8-10" onSubmit={() => {}} />);
  assertNamedButtons('switch-rounds');
  for (const shape of all('.card-shape')) {
    assert.ok(shape.getAttribute('aria-label'), 'карточка формы описана словами');
    assert.ok(!/^(🔺|🔵|🟩)/.test(shape.getAttribute('aria-label')!), 'подпись карточки не только значком');
  }

  const rounds = makeSupportPractice('8-10', 'w1d1_music').rounds!;
  await render(<TaskViewSupport rounds={rounds} onAnswer={() => {}} onSkip={() => {}} />);
  assertNamedButtons('social-practice');
  for (const fieldset of all('fieldset')) {
    assert.ok(fieldset.querySelector('legend'), 'у группы идей есть legend');
  }
  const skip = all<HTMLButtonElement>('button').find(b => b.textContent?.includes('Пропустить'));
  assert.ok(skip, 'пропуск доступен');
  assert.ok(skip!.textContent!.length > 3, 'пропуск подписан словами, а не значком');

  /* ------------- 3. фокус не теряется после выбора карточки ------------- */
  dom.window.sessionStorage.clear();
  const choice = TASK_BY_ID['stroop'].make(1, '8-10') as unknown as TaskInstance;
  await render(<TaskView key="focus" instance={choice} band="8-10" profileId="p" sessionId="s" step={1} onAnswer={() => {}} />);
  const first = all<HTMLButtonElement>('.options [role="radio"]')[0];
  await act(async () => { first.focus(); first.click(); });
  assert.equal(dom.window.document.activeElement, first, 'фокус остаётся на выбранном варианте');
  assert.equal(first.getAttribute('aria-checked'), 'true', 'состояние выбора объявлено');

  /* ------------- 4. опасные ситуации: имена, живая область, фокус ------------- */
  await act(async () => { root.render(<SupportKit band="8-10" competency="" />); });
  const openKit = all<HTMLButtonElement>('button').find(b => b.textContent?.includes('Набор поддержки'));
  assert.ok(openKit, 'набор поддержки открывается');
  assert.equal(openKit!.getAttribute('aria-expanded'), 'false', 'состояние набора объявлено');
  await act(async () => { openKit!.click(); });
  const safety = all<HTMLButtonElement>('button').find(b => b.textContent?.includes('Опасные ситуации'));
  assert.ok(safety, 'раздел опасных ситуаций доступен');
  await act(async () => { safety!.click(); });
  assertNamedButtons('safety-list');
  const firstStory = all<HTMLButtonElement>('.safety-story-list button')[0];
  assert.ok(firstStory, 'история выбирается кнопкой');
  assert.ok((firstStory!.textContent ?? '').trim().length > 10, 'у карточки истории есть слова, а не значок');
  await act(async () => { firstStory!.click(); });
  assertNamedButtons('safety-story');
  const speech = container.querySelector('.story-speech[aria-live="polite"]');
  assert.ok(speech, 'текст сцены объявляется живой областью');
  const restart = all<HTMLButtonElement>('button').find(b => b.textContent?.includes('Начать заново'));
  assert.ok(restart, 'начать историю заново можно кнопкой');

  await act(async () => { root.render(<></>); });
  console.log('  ok доступность: имена кнопок и групп, не только цветом, живые области, фокус после выбора');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
