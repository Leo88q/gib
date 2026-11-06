import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import NotificationSettings from '../components/NotificationSettings';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });

type View = {
  settings: { enabled: boolean; frequency: 'off' | 'weekly' | 'monthly'; lastSentAt: number | null };
  labels: Record<string, string>;
  canSendNow: boolean;
  reason: string | null;
  retryText: string;
  notice: string;
};
let view: View = {
  settings: { enabled: false, frequency: 'off', lastSentAt: null },
  labels: { off: 'Не отправлять', weekly: 'Раз в неделю', monthly: 'Раз в месяц' },
  canSendNow: false, reason: 'disabled', retryText: '',
  notice: 'Уведомлений нет. Включить можно в любой момент — это отдельное согласие.',
};
let failSave = false;
let posted: any = null;

(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  if (!init || !init.method) return new Response(JSON.stringify(view), { status: 200 });
  posted = JSON.parse(String(init.body));
  if (failSave) return new Response('{}', { status: 500 });
  const { enabled, frequency } = posted;
  view = {
    ...view,
    settings: { enabled, frequency, lastSentAt: view.settings.lastSentAt },
    canSendNow: enabled, reason: enabled ? null : 'disabled',
    notice: enabled ? `Отчёт взрослому: ${frequency === 'weekly' ? 'раз в неделю' : 'раз в месяц'}. Ребёнку сообщения не отправляются.` : 'Уведомлений нет. Включить можно в любой момент — это отдельное согласие.',
  };
  return new Response(JSON.stringify(view), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
const btn = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
async function click(label: string) {
  btn(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
async function render(key = 'a') {
  await act(async () => { root.render(<NotificationSettings key={key} profileId="p" />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}

async function main() {
  await render();

  // 1. По умолчанию — «не отправлять», три варианта частоты.
  assert.ok(text().includes('Уведомлений нет'), 'по умолчанию выключено');
  assert.equal(btn('Не отправлять').getAttribute('aria-pressed'), 'true', 'выключено — нажато');
  assert.equal(btn('Раз в неделю').getAttribute('aria-pressed'), 'false');
  assert.ok(btn('Раз в неделю') && btn('Раз в месяц'), 'есть только неделя и месяц — без «каждый день»');
  assert.ok(!text().includes('Каждый день'), 'ежедневной рассылки нет');
  console.log('  ok по умолчанию выключено, частоты только неделя и месяц');

  // 2. Включение отправляет согласие и частоту.
  await click('Раз в неделю');
  assert.deepEqual(posted, { profileId: 'p', enabled: true, frequency: 'weekly' }, 'на сервер ушли согласие и частота');
  assert.equal(btn('Раз в неделю').getAttribute('aria-pressed'), 'true', 'выбор отражён');
  assert.ok(text().includes('это отдельное согласие'), 'сказано, что это согласие');
  console.log('  ok включение — явное согласие с частотой');

  // 3. Отзыв возвращает в выключенное состояние.
  await click('Не отправлять');
  assert.deepEqual(posted, { profileId: 'p', enabled: false, frequency: 'off' });
  assert.equal(btn('Не отправлять').getAttribute('aria-pressed'), 'true');
  console.log('  ok отзыв согласия работает');

  // 4. Ограничение частоты объясняется в интерфейсе.
  view = { ...view, settings: { enabled: true, frequency: 'weekly', lastSentAt: 1 }, canSendNow: false, reason: 'too_soon', retryText: '3 дн.', notice: 'Отчёт взрослому: раз в неделю. Ребёнку сообщения не отправляются.' };
  await render('b');
  assert.ok(text().includes('Следующий отчёт можно отправить через 3 дн.'), 'видно, сколько ждать');
  assert.ok(text().includes('Сообщения ребёнку мы не отправляем'), 'граница по ребёнку названа');
  assert.ok(text().includes('не считается согласием на уведомления'), 'согласия разделены');
  console.log('  ok ограничение частоты и разделение согласий показаны');

  // 5. Ошибка сохранения не врёт про успех.
  failSave = true;
  await click('Раз в месяц');
  assert.ok(text().includes('Не удалось сохранить настройку'), 'ошибка показана');
  failSave = false;

  console.log('  ok уведомления в кабинете: по умолчанию выкл, согласие, частота, ошибки');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
