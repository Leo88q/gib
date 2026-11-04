import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ParentGate from '../components/ParentGate';

/**
 * Ворота кабинета без живого сервера.
 *
 * Ввод в поле здесь не имитируется: jsdom 26 + React 19 не доставляют
 * синтетическое событие ввода в контролируемое поле, поэтому полный путь
 * «ввёл код → вошёл» проверяет браузерный scripts/test-parent-gate-ui.ts.
 * Здесь — состояния, которые решают, увидит ли ребёнок кабинет.
 */
const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});

type Status = { configured: boolean; locked: boolean; retryAfterMs: number };
let status: Status = { configured: false, locked: false, retryAfterMs: 0 };
let holdStatus = false;
let releaseStatus: (() => void) | null = null;
let offline = false;

(globalThis as any).fetch = async (url: string) => {
  assert.equal(url, '/api/parent-pin');
  if (offline) throw new Error('offline');
  if (holdStatus) await new Promise<void>(r => { releaseStatus = r; });
  return new Response(JSON.stringify({ ...status, minLength: 4, maxLength: 8, attempts: 5, lockMs: 300000, sessionMs: 1800000 }), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const has = (text: string) => Boolean(container.textContent?.includes(text));

async function render(extra?: () => void) {
  await act(async () => { root.render(<ParentGate key={String(Math.random())}><p data-child>содержимое кабинета</p></ParentGate>); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  extra?.();
}

async function main() {
  // 1. Пока ответа нет — «проверяем доступ», но не содержимое кабинета.
  holdStatus = true;
  await act(async () => { root.render(<ParentGate><p data-child>содержимое кабинета</p></ParentGate>); });
  assert.ok(has('Проверяем доступ'), 'сказано, что доступ проверяется');
  assert.equal(container.querySelector('[data-child]'), null, 'до ответа данные не показаны');
  holdStatus = false;
  await act(async () => { releaseStatus?.(); await new Promise(r => setTimeout(r, 20)); });

  // 2. Код не задан — кабинет открыт, как раньше: старым семьям ничего не ломаем.
  status = { configured: false, locked: false, retryAfterMs: 0 };
  await render();
  assert.ok(container.querySelector('[data-child]'), 'без кода содержимое видно');

  // 3. Код задан и сессии нет — кабинет закрыт, данных ребёнка не видно.
  status = { configured: true, locked: false, retryAfterMs: 0 };
  dom.window.localStorage.removeItem('gib:parentUnlockedUntil');
  await render();
  assert.equal(container.querySelector('[data-child]'), null, 'без кода данные не показаны');
  assert.ok(has('Этот раздел — для взрослого'));
  assert.ok(has('не проверка личности'), 'честно сказано, что это не проверка личности взрослого');

  // 4. Кнопка входа неактивна, пока код не введён целиком.
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Открыть кабинет'))!;
  assert.equal(button.disabled, true, 'пустой код нельзя отправить');

  // 5. Короткая сессия: недавно подтверждённый вход не спрашивает код заново.
  dom.window.localStorage.setItem('gib:parentUnlockedUntil', String(Date.now() + 60000));
  await render();
  assert.ok(container.querySelector('[data-child]'), 'в пределах сессии код не спрашивают');

  // 6. Истёкшая сессия снова требует код.
  dom.window.localStorage.setItem('gib:parentUnlockedUntil', String(Date.now() - 1000));
  await render();
  assert.equal(container.querySelector('[data-child]'), null, 'истёкшая сессия не пускает');

  // 7. Блокировка: вместо поля — отсчёт, поле ввода убрано.
  dom.window.localStorage.removeItem('gib:parentUnlockedUntil');
  status = { configured: true, locked: true, retryAfterMs: 120000 };
  await render();
  assert.ok(has('Вход временно закрыт'), 'блокировка названа');
  assert.ok(has('с.'), 'сказано, сколько ждать');
  assert.equal(container.querySelector('input#parent-pin'), null, 'при блокировке поле ввода скрыто');

  // 8. Сбой сети не открывает кабинет и не оставляет пустой экран.
  offline = true;
  dom.window.localStorage.removeItem('gib:parentUnlockedUntil');
  await render();
  assert.equal(container.querySelector('[data-child]'), null, 'при сбое сети данные не показаны');
  assert.ok(has('Проверяем доступ'), 'экран честно ждёт, а не рисует кабинет');

  console.log('  ok ворота кабинета: проверка доступа, открыто без кода, закрыто с кодом, сессия, блокировка, сбой сети');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
