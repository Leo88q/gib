import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import PracticeMap from '../components/PracticeMap';
const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let calls = 0;
(globalThis as any).fetch = async (url: string) => { calls++; assert.equal(url, '/api/practice-map?profileId=p'); return calls === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ topics: [ { id: 'empathy', title: 'Замечать других', stories: 2, practices: 1 }, { id: 'relationships', title: 'Общаться', stories: 0, practices: 0 } ] }), { status: 200 }); };
const container = dom.window.document.getElementById('app')!; const root = createRoot(container);
async function main() {
  await act(async () => { root.render(<PracticeMap profileId="p" />); });
  assert.ok(container.textContent?.includes('Не удалось загрузить карту'));
  await act(async () => { ([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Попробовать'))!).click(); });
  assert.ok(container.textContent?.includes('Историй завершено: 2'));
  assert.ok(container.textContent?.includes('практик поддержки: 1'));
  assert.ok(container.textContent?.includes('Пока не встречалась'));
  assert.ok(container.textContent?.includes('не показывает ответы'));
  assert.equal(calls, 2);
  await act(async () => root.unmount()); dom.window.close();
  console.log('  ok карта: загрузка, ошибка, повтор и показ фактов без оценок в JSDOM');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
