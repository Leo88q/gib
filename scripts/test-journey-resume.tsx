import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import DayWelcome from '../components/DayWelcome';
import DayReflection from '../components/DayReflection';
import { journeyResumeKey, journeySignature, parseJourneyResume, serializeJourneyResume } from '../lib/day/journey-draft';
import { removeProfileJourneyResumes } from '../components/useJourneyResume';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let network = 0;
(globalThis as any).fetch = () => { network++; throw Error('unexpected network'); };
const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
const find = (label: string) => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label));
  assert.ok(button, `кнопка «${label}»`);
  return button as HTMLButtonElement;
};
const click = async (label: string) => { await act(async () => { find(label).click(); }); };
const render = async (view: React.ReactElement) => { await act(async () => { root.render(view); }); };
/** Перезагрузка страницы: компонент монтируется заново, состояние в памяти теряется. */
const reload = async (view: React.ReactElement) => { await act(async () => { root.render(<></>); }); await render(view); };

async function main() {
  /* ------------------------- 1. формат черновика ------------------------- */
  const signature = journeySignature('p1', 3);
  assert.equal(journeyResumeKey('p1', 3), 'gib:journey-resume:v1:p1:3');
  assert.equal(parseJourneyResume(null, signature), null);
  assert.equal(parseJourneyResume('не json', signature), null);
  // Чужой профиль и другой день не подходят.
  assert.equal(parseJourneyResume(JSON.stringify({ version: 1, signature: journeySignature('p2', 3), screen: 'welcome', phase: 'pause' }), signature), null);
  assert.equal(parseJourneyResume(JSON.stringify({ version: 1, signature: journeySignature('p1', 4), screen: 'welcome', phase: 'pause' }), signature), null);
  // Неизвестная версия, экран и фаза отклоняются.
  assert.equal(parseJourneyResume(JSON.stringify({ version: 2, signature, screen: 'welcome', phase: 'pause' }), signature), null);
  assert.equal(parseJourneyResume(JSON.stringify({ version: 1, signature, screen: 'story', phase: 'pause' }), signature), null);
  assert.equal(parseJourneyResume(JSON.stringify({ version: 1, signature, screen: 'welcome', phase: 'telepathy' }), signature), null);
  assert.deepEqual(parseJourneyResume(JSON.stringify({ version: 1, signature, screen: 'welcome', phase: 'pause' }), signature), { version: 1, signature, screen: 'welcome', phase: 'pause' });
  assert.deepEqual(serializeJourneyResume({ version: 1, signature, screen: 'reflection' }), JSON.stringify({ version: 1, signature, screen: 'reflection' }));
  // Отметки чувств и ответы в формат не попадают ни при каких условиях.
  assert.equal(serializeJourneyResume({ version: 1, signature, screen: 'welcome', phase: 'checkin' })!.includes('feeling'), false);
  assert.equal(serializeJourneyResume({ version: 1, signature: '', screen: 'welcome', phase: 'pause' }), null);

  /* ------------------- 2. возврат на экран подготовки ------------------- */
  dom.window.sessionStorage.clear();
  const upToPause = async () => {
    let started = 0;
    await render(<DayWelcome band="8-10" starting={false} error="" profileId="p1" day={3} onStart={() => { started++; }} onBack={() => {}} />);
    await click('Продолжить');
    return () => started;
  };
  let started = await upToPause();
  const key = journeyResumeKey('p1', 3);
  assert.ok(dom.window.sessionStorage.getItem(key)?.includes('"phase":"pause"'), 'место остановки сохранено');
  assert.equal(JSON.stringify(dom.window.sessionStorage.getItem(key)).includes('Радость'), false, 'отметки чувств не сохранены');
  // «Перезагрузка»: новый экземпляр компонента видит, что ребёнок уже дошёл до передышки.
  let restarted = 0;
  await reload(<DayWelcome band="8-10" starting={false} error="" profileId="p1" day={3} onStart={() => { restarted++; }} onBack={() => {}} />);
  assert.ok(text().includes('Ты вернулся на этот экран'), 'восстановленный экран сообщает о себе');
  assert.ok(text().includes('Передышка необязательна'), 'сразу открыта передышка, а не отметка');
  await click('Перейти к миссии');
  assert.equal(restarted, 1, 'миссия начинается');
  assert.equal(dom.window.sessionStorage.getItem(key), null, 'после старта черновик удалён');

  /* ---------------- 3. другой день и другой профиль не мешают --------------- */
  dom.window.sessionStorage.setItem(journeyResumeKey('p1', 5), JSON.stringify({ version: 1, signature: journeySignature('p1', 5), screen: 'welcome', phase: 'pause' }));
  await reload(<DayWelcome band="8-10" starting={false} error="" profileId="p1" day={5} onStart={() => {}} onBack={() => {}} />);
  assert.ok(text().includes('Ты вернулся'), 'свой день восстанавливается');
  dom.window.sessionStorage.clear();
  dom.window.sessionStorage.setItem(journeyResumeKey('p2', 3), JSON.stringify({ version: 1, signature: journeySignature('p2', 3), screen: 'welcome', phase: 'pause' }));
  await reload(<DayWelcome band="8-10" starting={false} error="" profileId="p1" day={3} onStart={() => {}} onBack={() => {}} />);
  assert.ok(!text().includes('Ты вернулся'), 'черновик другого профиля игнорируется');
  assert.ok(text().includes('Как я сейчас?'), 'открыта обычная отметка');

  /* ------------------- 4. без профиля ничего не пишется ------------------- */
  dom.window.sessionStorage.clear();
  await render(<DayWelcome band="5-7" starting={false} error="" profileId={undefined} day={undefined} onStart={() => {}} onBack={() => {}} />);
  await click('Продолжить');
  assert.equal(dom.window.sessionStorage.length, 0, 'без профиля и дня черновик не создаётся');

  /* --------------------- 5. возврат на экран итога --------------------- */
  dom.window.sessionStorage.clear();
  await render(<DayReflection profileId="p1" day={3} onDone={() => {}} />);
  assert.ok(!text().includes('Ты вернулся на экран итога'), 'первый показ без пометки');
  assert.ok(dom.window.sessionStorage.getItem(journeyResumeKey('p1', 3))?.includes('"screen":"reflection"'), 'факт экрана итога сохранён');
  let done = 0;
  await reload(<DayReflection profileId="p1" day={3} onDone={() => { done++; }} />);
  assert.ok(text().includes('Ты вернулся на экран итога'), 'возврат на итог виден');
  assert.ok(!text().includes('Выбрано:'), 'прошлый выбор не восстановлен');
  await click('Домой');
  assert.equal(done, 1);
  assert.equal(dom.window.sessionStorage.getItem(journeyResumeKey('p1', 3)), null, 'после завершения черновик удалён');

  /* --------------------- 6. очистка при удалении профиля --------------------- */
  dom.window.sessionStorage.clear();
  dom.window.sessionStorage.setItem(journeyResumeKey('p1', 1), JSON.stringify({ version: 1, signature: journeySignature('p1', 1), screen: 'welcome', phase: 'checkin' }));
  dom.window.sessionStorage.setItem(journeyResumeKey('p1', 2), JSON.stringify({ version: 1, signature: journeySignature('p1', 2), screen: 'reflection' }));
  dom.window.sessionStorage.setItem(journeyResumeKey('p9', 1), JSON.stringify({ version: 1, signature: journeySignature('p9', 1), screen: 'reflection' }));
  removeProfileJourneyResumes(dom.window.sessionStorage, 'p1');
  assert.equal(dom.window.sessionStorage.length, 1, 'чужие черновики остаются');
  assert.ok(dom.window.sessionStorage.getItem(journeyResumeKey('p9', 1)), 'черновик другого профиля не удалён');

  assert.equal(network, 0, 'приватные экраны не ходят в сеть');
  console.log('  ok возобновление дня: подготовка и итог возвращаются без отметок, чужие профили и дни не подхватываются');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
