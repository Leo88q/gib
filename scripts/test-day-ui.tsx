import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import DayWelcome from '../components/DayWelcome';
import DayReflection from '../components/DayReflection';
import Rewards from '../components/Rewards';
import SupportPractice from '../components/SupportPractice';
import { makeSupportPractice } from '../lib/content/support-practice';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let requests = 0; (globalThis as any).fetch = () => { requests++; throw Error('unexpected network'); };
const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const find = (text: string) => { const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)); assert.ok(button, text); return button; };
const click = async (text: string) => { await act(async () => { find(text).click(); }); };
async function main() {
  let starts = 0, backs = 0, done = 0, reflects = 0;
  await act(async () => root.render(<DayWelcome band="5-7" starting={false} error="" onStart={() => starts++} onBack={() => backs++} />));
  assert.equal(find('Как я сейчас?').getAttribute('aria-expanded'), 'false');
  assert.ok(!container.textContent?.includes('Ты отметил:'));
  await click('Как я сейчас?'); assert.equal(find('Закрыть отметку').getAttribute('aria-expanded'), 'true');
  await click('Радость'); assert.ok(container.textContent?.includes('Ты отметил: радость'));
  await click('Закрыть отметку'); await click('Как я сейчас?'); assert.ok(!container.textContent?.includes('Ты отметил: радость'));
  await click('Продолжить');
  await click('Набор поддержки'); assert.ok(container.textContent?.includes('Можно пропустить'));
  await click('Перейти к миссии'); assert.equal(starts, 1); assert.equal(backs, 0);
  await act(async () => root.render(<DayWelcome band="8-10" starting={true} error="" onStart={() => starts++} onBack={() => backs++} />));
  assert.equal(find('Открываем').disabled, true); assert.equal(find('Домой').disabled, true);
  await act(async () => root.render(<DayReflection onDone={() => done++} />));
  assert.ok(container.textContent?.includes('Можно пропустить'));
  await click('История'); assert.equal(find('История').getAttribute('aria-pressed'), 'true');
  await click('История'); assert.equal(find('История').getAttribute('aria-pressed'), 'false');
  await click('Задания'); await click('Домой'); assert.equal(done, 1);
  await act(async () => root.render(<Rewards stars={1} xp={1} coins={1} comboBest={0} tasks={1} correct={0} newBadges={[]} badges={[]} levelUp={null} program={null} onReflect={() => reflects++} onDone={() => done++} />));
  await click('Домой'); assert.equal(done, 2); assert.equal(reflects, 0);
  await click('Подвести итог'); assert.equal(reflects, 1);
  assert.equal(requests, 0); assert.equal(dom.window.sessionStorage.length, 0); assert.equal(dom.window.localStorage.length, 0);
  const rounds = makeSupportPractice('8-10', 'w1d1_music').rounds!;
  let sent: number[] | null = null;
  const practice = () => <SupportPractice rounds={rounds} draftKey="draft" onAnswer={cells => { sent = cells; }} onSkip={() => { sent = []; }} />;
  await act(async () => root.render(practice()));
  assert.equal(find('Все идеи').disabled, true);
  await click(rounds[0].options[0]); await click('Следующая ситуация'); assert.equal(dom.window.document.activeElement?.tagName, 'LEGEND'); await click(rounds[1].options[0]);
  assert.equal(find('Все идеи').disabled, true);
  await act(async () => root.render(<DayReflection onDone={() => {}} />));
  await act(async () => root.render(practice()));
  assert.ok(container.textContent?.includes('восстановлены'));
  assert.ok(container.textContent?.includes('Ситуация 3 из 3'));
  await click(rounds[2].options[0]); await click('Посмотреть все идеи');
  assert.equal(dom.window.document.activeElement?.id, 'idea-summary-title'); assert.ok(!find('Готово').disabled);
  const edit = container.querySelector<HTMLButtonElement>('[aria-label="Изменить идею для ситуации 1"]')!;
  await act(async () => edit.click());
  assert.equal(find(rounds[0].options[0]).getAttribute('aria-pressed'), 'true');
  await click(rounds[0].options[1]); await click('Посмотреть все идеи');
  assert.ok(container.textContent?.includes(rounds[0].options[1]));
  await click('Пропустить упражнение'); assert.ok(container.textContent?.includes('Миссия и награда не изменятся'));
  await click('Остаться'); assert.equal(sent, null);
  await click('Пропустить упражнение'); await click('Да, пропустить'); assert.deepEqual(sent, []);
  await click('Готово'); assert.deepEqual(sent, [1, 0, 0]);
  // Changing the task without unmount must not copy a previous draft into a different key.
  const otherRounds = makeSupportPractice('5-7', 'w1d2').rounds!;
  await act(async () => root.render(<SupportPractice rounds={otherRounds} draftKey="other" onAnswer={() => {}} onSkip={() => {}} />));
  assert.equal(dom.window.sessionStorage.getItem('other'), null);
  assert.ok(container.textContent?.includes(otherRounds[0].prompt));
  for (const band of ['5-7', '8-10', '11-13'] as const) {
    for (const scenario of ['w1d1', 'w1d1_picture', 'w1d3_garden', 'w1d5_puppet']) {
      const exercise = makeSupportPractice(band, scenario).rounds!;
      let answer: number[] | null = null;
      await act(async () => root.render(<SupportPractice key={`${band}-${scenario}`} rounds={exercise} onAnswer={value => { answer = value; }} onSkip={() => {}} />));
      for (let i = 0; i < exercise.length; i++) {
        assert.ok(container.textContent?.includes(exercise[i].prompt));
        const buttons = container.querySelectorAll<HTMLButtonElement>('.support-round-options button');
        assert.equal(buttons.length, 3);
        await act(async () => buttons[i % 3].click());
        await click(i === exercise.length - 1 ? 'Посмотреть все идеи' : 'Следующая ситуация');
      }
      await click('Готово'); assert.deepEqual(answer, [0, 1, 2]);
    }
  }
  dom.window.sessionStorage.clear();
  console.log('  ok книжка идей: четыре сюжета, три возраста, просмотр и отправка без оценки');
  console.log('  ok практика восстанавливает черновик, допускает одинаковые индексы и требует три выбора');
  await act(async () => root.unmount()); dom.window.close();
  console.log('  ok необязательные отметка, передышка и итог доступны без сети и хранения; итог можно пропустить');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
