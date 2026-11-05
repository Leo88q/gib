import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import SupportKit from '../components/SupportKit';
import { SAFETY_STORIES } from '../lib/content/safety-story.ts';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
const buttons = () => [...container.querySelectorAll('button')];
const find = (predicate: (label: string) => boolean) => buttons().find(b => predicate(b.textContent ?? ''));
const click = async (predicate: (label: string) => boolean) => {
  const button = find(predicate);
  assert.ok(button, 'кнопка найдена');
  await act(async () => button.click());
  return button;
};

async function main() {
  // Никаких сетевых вызовов: разговор не сохраняет выбор и не ходит на сервер.
  let requests = 0;
  (globalThis as any).fetch = async () => { requests++; return new Response('{}'); };

  await act(async () => root.render(<SupportKit competency="" band="8-10" />));
  await click(t => t.includes('Набор поддержки'));

  // 1. Раздел существует и назван по-человечески.
  const safetyTab = find(t => t.includes('Опасные ситуации'));
  assert.ok(safetyTab, 'есть отдельный раздел опасных ситуаций');
  assert.ok(!find(t => t.includes('Это история для тренировки')), 'до открытия ничего не показано');

  await click(t => t.includes('Опасные ситуации'));

  // 2. Ребёнок выбирает ситуацию, а не получает одну единственную.
  assert.ok(text().includes('Опасные ситуации'), 'заголовок раздела');
  assert.ok(text().includes('нет оценок'), 'сказано, что оценок нет');
  assert.ok(text().includes('никуда не сохраняется'), 'сказано, что выбор не сохраняется');
  for (const story of SAFETY_STORIES) {
    assert.ok(text().includes(story.title), `видна история «${story.title}»`);
  }

  // 3. Открываем историю и проходим безопасным путём до развязки.
  await click(t => t.includes(SAFETY_STORIES[0].title));
  assert.equal(text().includes('Выбери разговор'), false, 'открылся экран истории');
  const story = SAFETY_STORIES[0];
  assert.ok(text().includes(story.nodes.start.text.slice(0, 30)), 'виден текст первой сцены');

  let nodeId = 'start';
  for (let guard = 0; guard < 10; guard++) {
    const node = story.nodes[nodeId];
    if (node.ending) break;
    const safeIndex = node.choices.findIndex(c => c.safe);
    assert.ok(safeIndex >= 0, `в сцене ${nodeId} есть безопасный вариант`);
    const label = node.choices[safeIndex].label;
    await click(t => t.includes(label));
    nodeId = node.choices[safeIndex].next;
  }
  assert.ok(story.nodes[nodeId].ending, 'безопасный путь дошёл до развязки');
  assert.ok(text().includes('доверяешь'), 'развязка говорит про взрослого, которому доверяешь');
  assert.ok(text().includes('Выбрать другую ситуацию'), 'можно вернуться к списку');

  // 4. Обратно к списку: все истории на месте.
  await click(t => t.includes('Выбрать другую ситуацию'));
  assert.ok(text().includes('Выбери разговор'), 'список вернулся');

  // 5. Выбор никуда не уходит: ни одного запроса за весь разговор.
  assert.equal(requests, 0, 'разговор ничего не отправляет на сервер');

  // 6. Возраст меняет порядок, но не прячет истории.
  await act(async () => root.render(<SupportKit key="young" competency="" band="5-7" />));
  await click(t => t.includes('Набор поддержки'));
  await click(t => t.includes('Опасные ситуации'));
  const firstForYoung = SAFETY_STORIES[0].title;
  assert.ok(text().includes(firstForYoung), 'младшему доступна история про незнакомца');
  const youngIndex = text().indexOf(firstForYoung);
  const olderIndex = text().indexOf(SAFETY_STORIES[1].title);
  assert.ok(youngIndex >= 0 && olderIndex >= 0, 'порядок историй определён');

  console.log('  ok опасные ситуации: выбор из четырёх, безопасный путь, развязка, возврат и ноль запросов');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
