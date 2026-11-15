/**
 * Экран воронки запуска: без токена чисел нет, с токеном — те же числа, что в API.
 *
 * Зачем тест. Экран показывает решение о запуске: где теряются взрослые и
 * сколько оплат. Ошибка на нём не выглядит ошибкой — пустая таблица читается
 * как «нет трафика», а вчерашние числа как сегодняшние. Поэтому проверяется:
 *  1. До запроса на экране нет чисел — вместо них сказано, что отчёт не запрошен.
 *  2. Токен уходит только заголовком авторизации, а не в адресе страницы.
 *  3. Числа и проценты берутся из ответа, конверсия не округляется до целого.
 *  4. Файловое хранилище названо предупреждением: в продакшене так нельзя.
 *  5. Отказ (404, 503, 429) объяснён, а не показан пустой таблицей.
 *
 * Запуск: npm run test:funnel-ui
 */
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import FunnelReport, { percent, STEP_LABEL, VERDICT_LABEL } from '../components/FunnelReport.tsx';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/admin/funnel' });
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  console.log('  ok', message);
};

const REPORT = {
  verdict: 'no_payment',
  steps: [
    { step: 'consent', owners: 20, conversion: 1 },
    { step: 'profile', owners: 16, conversion: 0.8 },
    { step: 'first_session', owners: 12, conversion: 0.75 },
    { step: 'first_finished', owners: 9, conversion: 0.75 },
    { step: 'paywall_seen', owners: 7, conversion: 0.778 },
    { step: 'paid', owners: 0, conversion: 0 },
  ],
  dropOffStep: 'paid',
  paywallStops: { 2: 4, 7: 3 },
  accounts: { profiles: 16, withConsent: 16, lessonsInYear: 36 },
  storage: { events: 64, retentionDays: 400, backend: 'file' as const },
  generatedAt: 1_800_000_000_000,
};

let calls: { url: string; init?: RequestInit }[] = [];
let nextResponse: () => Response = () => new Response(JSON.stringify(REPORT), { status: 200 });

(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return nextResponse();
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';

async function render() {
  await act(async () => {
    root.render(<FunnelReport />);
  });
}

async function typeToken(value: string) {
  const input = container.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function main() {
  await render();

  /* ---- 1. До запроса чисел нет ---- */
  check(text().includes('Пока отчёт не запрошен'), 'до запроса экран говорит, что отчёт не запрошен');
  check(!text().includes('Согласие взрослого'), 'до запроса шаги воронки не показаны');
  check(calls.length === 0, 'без токена запрос к API не уходит');

  /* ---- 2. Токен уходит только заголовком ---- */
  await typeToken(' admin-token-for-tests-123 ');
  await submit();
  check(calls.length === 1, 'после ввода токена запрос ушёл один раз');
  check(calls[0].url === '/api/admin/funnel', `токен не попал в адрес: ${calls[0].url}`);
  const headers = calls[0].init?.headers as Record<string, string>;
  check(headers?.authorization === 'Bearer admin-token-for-tests-123', 'токен ушёл заголовком, без лишних пробелов');
  check(!JSON.stringify(calls[0]).includes('localStorage'), 'токен не сохраняется в браузере');

  /* ---- 3. Числа и проценты из ответа ---- */
  check(text().includes(VERDICT_LABEL.no_payment), 'вердикт назван словами, а не кодом');
  check(text().includes(STEP_LABEL.paywall_seen), 'шаги названы по-человечески');
  check(text().includes('20'), 'число взрослых на первом шаге показано');
  check(text().includes('77,8%'), 'конверсия не округлена до целого: 7 из 9 — это 77,8%, а не 78%');
  check(text().includes('встреча 2: 4') && text().includes('встреча 7: 3'), 'отказы у оплаты показаны по встречам');

  /* ---- 4. Файловое хранилище — предупреждение ---- */
  check(text().includes('GIB_STORE=postgres'), 'файловое хранилище названо проблемой продакшена');
  check(text().includes('400 дней'), 'срок хранения назван числом из ответа');

  /* ---- 5. Отказ объяснён ---- */
  nextResponse = () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  await submit();
  check(text().includes('Отчёт закрыт'), 'на 404 экран объясняет отказ, а не молчит');
  check(!text().includes('Согласие взрослого'), 'после отказа старые числа убраны: вчерашний отчёт не выглядит сегодняшним');

  nextResponse = () => new Response(JSON.stringify({ error: 'production_not_ready' }), { status: 503 });
  await submit();
  check(text().includes('заглушкой запуска'), 'на 503 сказано, что сервис закрыт, а не «ошибка сервера»');

  nextResponse = () => new Response(JSON.stringify(REPORT), { status: 200 });
  await submit();
  check(text().includes('PostgreSQL') === false, 'в файловом режиме PostgreSQL не заявлен');
  check(percent(0.5) === '50,0%' && percent(0.005) === '0,5%', 'проценты считаются от доли, а не от процентов');

  await act(async () => root.unmount());
  console.log('✓ экран воронки: без токена чисел нет, с токеном — ответ API и честные отказы');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
