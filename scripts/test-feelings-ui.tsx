import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import FeelingsCheckIn from '../components/FeelingsCheckIn';
import FeelingsConsent from '../components/FeelingsConsent';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const buttons = () => [...container.querySelectorAll('button')];
const click = async (predicate: (text: string) => boolean) => {
  const button = buttons().find(b => predicate(b.textContent ?? ''));
  assert.ok(button, 'кнопка найдена');
  await act(async () => button.click());
  return button;
};

/** Подставной сервер: согласие и сохранённые отметки. */
function installFetch({ enabled }: { enabled: boolean }) {
  const state = { enabled, saved: [] as string[][] };
  (globalThis as any).fetch = async (url: string, opts: RequestInit = {}) => {
    const method = opts.method ?? 'GET';
    if (method === 'GET') return new Response(JSON.stringify({ enabled: state.enabled, retentionDays: 90, limit: 60, checkins: [] }));
    const body = JSON.parse(String(opts.body));
    if (body.action === 'consent') {
      state.enabled = body.enabled;
      if (!body.enabled) state.saved = [];
      return new Response(JSON.stringify({ enabled: state.enabled, retentionDays: 90, limit: 60, checkins: [] }));
    }
    if (!state.enabled) return new Response(JSON.stringify({ error: 'consent_required' }), { status: 403 });
    state.saved.push(body.feelings);
    return new Response(JSON.stringify({ enabled: true, retentionDays: 90, limit: 60, checkins: [{ id: 'f_1', day: '2026-11-04', feelings: body.feelings }] }));
  };
  return state;
}

async function main() {
  // 1. Без согласия в детском экране нет кнопки сохранения.
  let server = installFetch({ enabled: false });
  await act(async () => root.render(<FeelingsCheckIn band="8-10" profileId="p" />));
  await act(async () => { await Promise.resolve(); });
  await click(text => text.includes('Радость'));
  assert.ok(!buttons().some(b => /Сохранить мою отметку/.test(b.textContent ?? '')), 'без согласия сохранять нечего');
  assert.ok(container.textContent!.includes('Отметки не сохраняются'), 'текст объясняет отсутствие сохранения');
  assert.equal(server.saved.length, 0, 'ничего не отправлено');

  // 2. С согласием кнопка появляется только после выбора чувства.
  // Компонент перемонтируем с новым ключом: тот же элемент сохранил бы выбор из шага 1.
  server = installFetch({ enabled: true });
  await act(async () => root.render(<FeelingsCheckIn key="with-consent" band="8-10" profileId="p" />));
  // Согласие подгружается эффектом: даём ему завершиться до проверки кнопки.
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  assert.ok(!buttons().some(b => /Сохранить мою отметку/.test(b.textContent ?? '')), 'без выбора кнопки нет');
  await click(text => text.includes('Радость'));
  assert.ok(buttons().some(b => /Сохранить мою отметку/.test(b.textContent ?? '')), 'после выбора можно сохранить');

  // 3. Сохранение отправляет выбранные чувства и подтверждает.
  await click(text => /Сохранить мою отметку/.test(text));
  assert.deepEqual(server.saved.at(-1), ['joy']);
  assert.ok(container.textContent!.includes('Отметка сохранена'), 'подтверждение видно');
  assert.ok(container.textContent!.includes('удалить'), 'сказано, что удалить можно в кабинете');
  assert.ok(!container.textContent!.includes('Сохранить мою отметку'), 'повторной кнопки нет');

  // 4. Пропуск остаётся возможным: кнопка сохранения не единственный путь.
  await click(text => /Снять отметки/.test(text));
  assert.ok(container.textContent!.includes('Ничего не выбрано. Можно просто пропустить.'), 'отметки можно снять');

  // 5. Кабинет: по умолчанию выключено, включение и отзыв работают.
  server = installFetch({ enabled: false });
  await act(async () => root.render(<FeelingsConsent profileId="p" />));
  await act(async () => { await Promise.resolve(); });
  assert.ok(container.textContent!.includes('выключено'), 'кабинет показывает выключенное сохранение');
  // При выключенном сохранении срок не нужен: он появляется вместе с согласием.
  await click(text => /Разрешить сохранение/.test(text));
  assert.equal(server.enabled, true, 'согласие включено');
  assert.ok(container.textContent!.includes('включено'));
  assert.ok(container.textContent!.includes('до 90 дней'), 'срок хранения показан при включённом сохранении');

  // 6. Отзыв согласия доступен и описан честно.
  assert.ok(container.textContent!.includes('Если согласие отозвать, сохранённое удаляется.'), 'последствия отзыва названы');
  await click(text => /Отозвать согласие/.test(text));
  assert.equal(server.enabled, false, 'согласие отозвано');

  // 7. Юридическое ограничение видно в интерфейсе, а не спрятано в коде.
  assert.ok(container.textContent!.includes('профильный юрист'), 'ограничение названо в кабинете');
  assert.ok(container.textContent!.includes('не попадают в отчёт по активности'), 'сказано, что отчёта это не касается');

  console.log('  ok отметки в интерфейсе: сохранение только с согласия и по желанию, отзыв стирает, ограничение видно');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
