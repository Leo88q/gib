import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import FamilyIdeas from '../components/FamilyIdeas';
import { advanceFamily, emptyFamily, publicFamily } from '../lib/engine/family';
const dom = new JSDOM('<div id="app"></div>', {url:'https://gib.test/'});
Object.assign(globalThis, { React, window:dom.window, document:dom.window.document, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true });
let state = emptyFamily(), failOnce = true; let posted: any[] = [];
(globalThis as any).fetch = async (_url: string, opts: RequestInit) => {
  if (opts.method !== 'POST') return new Response(JSON.stringify(publicFamily(state,'8-10')));
  const body = JSON.parse(String(opts.body)); posted.push(body);
  const result = advanceFamily(state, body, 'inst'); assert.ok(!('error' in result)); state = result.state;
  if (failOnce) { failOnce = false; throw Error('lost response'); }
  return new Response(JSON.stringify({ ...publicFamily(state,'8-10'), replay:result.replay }));
};
const container = dom.window.document.getElementById('app')!, root = createRoot(container);
const click = async (text: string) => { const b = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text)); assert.ok(b, text); await act(async () => b.click()); };
async function main() {
  await act(async () => root.render(<FamilyIdeas profileId="p" />));
  assert.ok(container.textContent?.includes('Наград и штрафов нет'));
  await click('Выбрать идею'); assert.equal(state.current?.status, 'chosen'); assert.ok(container.textContent?.includes('Повторить отправку'));
  await click('Повторить отправку'); assert.equal(posted[0].operationId, posted[1].operationId); assert.equal(state.version, 1);
  await click('Мы попробовали'); assert.equal(state.current?.status, 'reported');
  assert.ok(!container.textContent?.includes('Подтвердить отметку'));
  await act(async () => root.render(<FamilyIdeas profileId="p" parentView />));
  await click('Подтвердить отметку'); assert.equal(state.completed, 1); assert.ok(container.textContent?.includes('не проверяет, кто нажал'));
  await click('Завершить'); assert.equal(state.current, null);
  await act(async () => root.unmount()); dom.window.close();
  console.log('  ok семейный интерфейс: добровольность, повтор потерянного ответа, отметка и подтверждение в JSDOM');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
