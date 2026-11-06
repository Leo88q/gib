import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import FamilyGoal from '../components/FamilyGoal';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });

type Payload = { confirmed: number; target: number; members: number; reached: boolean; notice: string };
let payload: Payload = { confirmed: 3, target: 8, members: 2, reached: false, notice: 'Общая цель семьи: 3 из 8. Осталось 5 — если захочется.' };
let failLoad = false;
let failSave = false;
let posted: unknown = null;

(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  if (!init || !init.method) {
    if (failLoad) return new Response('{}', { status: 500 });
    assert.ok(String(url).startsWith('/api/family-goal?profileId='), 'читаем цель семьи');
    return new Response(JSON.stringify({ goal: payload, limits: { min: 4, max: 60, step: 4 } }), { status: 200 });
  }
  posted = JSON.parse(String(init.body));
  if (failSave) return new Response('{}', { status: 500 });
  const target = (posted as { target: number }).target;
  payload = { ...payload, target, reached: payload.confirmed >= target };
  return new Response(JSON.stringify({ goal: payload }), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
async function render() {
  await act(async () => { root.render(<FamilyGoal profileId="p" />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
async function choose(target: string) {
  const select = container.querySelector('select') as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(select, target);
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

async function main() {
  // 1. Обычный показ: число семьи, пояснение, без имён и разбивки.
  await render();
  assert.ok(text().includes('Общая цель семьи'));
  assert.ok(text().includes('3 из 8'), 'показан прогресс');
  assert.ok(text().includes('не показывается'), 'сказано, что вклад не раскрывается');
  assert.ok(!text().includes('Первый') && !text().includes('Второй'), 'имён детей нет');
  assert.ok(text().includes('Цель не влияет на доступ'), 'сказано, что цель не гейт');
  const bar = container.querySelector('.family-goal-bar');
  assert.ok(bar, 'есть полоса прогресса');
  assert.equal(bar!.getAttribute('role'), 'img');
  assert.ok(bar!.getAttribute('aria-label')?.includes('3 из 8'), 'прогресс доступен скринридеру');

  // 2. Размер цели можно изменить, и это сохраняется.
  await choose('12');
  assert.deepEqual(posted, { profileId: 'p', target: 12 }, 'на сервер ушёл только размер');
  assert.ok(text().includes('12'), 'новый размер показан');
  assert.ok(text().includes('договорённость'), 'объяснено, что цель можно менять');

  // 3. Ошибка сохранения не врёт про успех.
  failSave = true;
  await choose('16');
  assert.ok(text().includes('Не удалось сохранить размер цели'), 'ошибка показана');
  failSave = false;

  // 4. Ошибка загрузки — понятное сообщение, а не пустой блок.
  failLoad = true;
  await act(async () => { root.render(<FamilyGoal key="reload" profileId="p" />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  assert.ok(text().includes('Не удалось загрузить семейную цель'), 'ошибка загрузки показана');

  // 5. Один ребёнок — другой текст, без обещания соревнования.
  failLoad = false;
  payload = { confirmed: 0, target: 4, members: 1, reached: false, notice: 'Общая цель семьи — 4 совместных отметок. Начать можно когда угодно.' };
  await act(async () => { root.render(<FamilyGoal key="one" profileId="p" />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  assert.ok(text().includes('Пока в цели один ребёнок'), 'для одного ребёнка честный текст');

  console.log('  ok общая цель в кабинете: прогресс, размер, ошибки, один и несколько детей');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
