import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import DataControls from '../components/DataControls';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });

type Payload = {
  profile: { name: string; age: number } | null;
  counts: { sessions: number; tasks: number; stories: number; familyMarks: number; feelings: number; events: number };
  feelings: { enabled: boolean; retentionDays: number; limit: number };
  updatedAt: number;
};
let payload: Payload = {
  profile: { name: 'Мира', age: 9 },
  counts: { sessions: 7, tasks: 21, stories: 4, familyMarks: 2, feelings: 3, events: 40 },
  feelings: { enabled: true, retentionDays: 90, limit: 60 },
  updatedAt: 1,
};
let failLoad = false;
let exported = 0;
let deleted = 0;

(globalThis as any).fetch = async (url: string) => {
  assert.ok(String(url).startsWith('/api/profile/data?profileId=p'), `сводка по профилю: ${url}`);
  if (failLoad) return new Response('{}', { status: 500 });
  return new Response(JSON.stringify(payload), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
async function render(key = 'a') {
  await act(async () => { root.render(<DataControls key={key} profileId="p" busy={false} onExport={() => { exported++; }} onDelete={() => { deleted++; }} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;

async function main() {
  await render();

  // 1. Категории и количество видны, содержимого нет.
  assert.ok(text().includes('Мира'), 'профиль назван');
  assert.ok(text().includes('Сохранённые чувства'), 'категория чувств есть');
  assert.ok(text().includes('Семейные отметки'));
  assert.ok(!text().includes('радость') && !text().includes('спокойствие'), 'содержимое чувств не показано');
  console.log('  ok сводка: категории и количество, без содержимого');

  // 2. Решения взрослого объяснены, включая отзыв.
  assert.ok(text().includes('Сохранение включено'), 'состояние согласия на чувства видно');
  assert.ok(text().includes('до 90 дней'), 'срок хранения назван');
  assert.ok(text().includes('отзыв стирает сохранённое'), 'сказано, что отзыв стирает');
  assert.ok(text().includes('не отправляем напоминания'), 'уведомления честно выключены');
  assert.ok(text().includes('не подключена'), 'аналитика честно не подключена');
  console.log('  ok решения взрослого: чувства, уведомления, аналитика');

  // 3. Кнопки выгрузки и удаления работают и не дублируются в блоке.
  assert.equal(container.querySelectorAll('button').length, 2, 'ровно две кнопки');
  button('Скачать данные ребёнка').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  button('Удалить профиль и все данные').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(exported, 1); assert.equal(deleted, 1);
  console.log('  ok выгрузка и удаление доступны в одном месте');

  // 4. Согласие выключено — другой текст, без намёка, что данные есть.
  payload = { ...payload, counts: { ...payload.counts, feelings: 0 }, feelings: { enabled: false, retentionDays: 90, limit: 60 } };
  await render('b');
  assert.ok(text().includes('Сохранение выключено'), 'выключенное согласие названо');
  assert.ok(text().includes('никуда не записываются'), 'сказано, что не записывается');
  console.log('  ok выключенные чувства описаны честно');

  // 5. Ошибка загрузки — понятное сообщение.
  failLoad = true;
  await render('c');
  assert.ok(text().includes('Не удалось загрузить'), 'ошибка загрузки показана');
  console.log('  ok сбой загрузки объяснён');

  console.log('  ok данные и согласия: сводка, решения, выгрузка, удаление, ошибки');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
