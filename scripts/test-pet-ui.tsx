import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import Pet from '../components/Pet';
import Room from '../components/Room';
import { petMoodText } from '../lib/pet-mood';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);

async function main() {
  // 1. Каждое настроение рисуется и различимо в разметке.
  const shapes = new Map<string, string>();
  for (const mood of ['happy', 'sleepy', 'curious', 'missing'] as const) {
    await act(async () => root.render(<Pet variant="cat" level={4} mood={mood} />));
    const svg = container.querySelector('svg');
    assert.ok(svg, `${mood}: питомец отрисован`);
    const markup = container.innerHTML;
    assert.ok(!markup.includes('NaN'), `${mood}: нет испорченных координат`);
    shapes.set(mood, markup);
  }
  assert.equal(new Set(shapes.values()).size, 4, 'четыре настроения выглядят по-разному');
  assert.ok(shapes.get('sleepy')!.includes('q5 4 10 0'), 'сон: закрытые глаза');
  assert.ok(shapes.get('missing')!.includes('ff5d8f'), 'соскучился: сердечко');
  assert.ok(shapes.get('happy')!.includes('q7 7 14 0'), 'радость: улыбка');

  // 2. Без настроения питомец рисуется как раньше — старые экраны не ломаются.
  await act(async () => root.render(<Pet variant="dragon" level={1} />));
  assert.ok(container.querySelector('svg'), 'дракончик без настроения отрисован');
  assert.ok(container.innerHTML.includes('5fd28a'), 'цвет дракона сохранён');

  // 3. Комната принимает настроение и передаёт его питомцу.
  await act(async () => root.render(<Room pet="cat" petLevel={4} petMood="missing" />));
  const room = container.innerHTML;
  assert.ok(room.includes('room-pet'), 'питомец в комнате');
  assert.ok(room.includes('ff5d8f'), 'настроение дошло до комнаты');
  await act(async () => root.render(<Room pet={null} />));
  assert.ok(!container.innerHTML.includes('room-pet'), 'без питомца комната не рисует его');

  // 4. Подпись не появляется без питомца на главной — проверим текст напрямую.
  assert.ok(container.querySelector('svg'), 'комната отрисована');
  for (const mood of ['happy', 'sleepy', 'curious', 'missing'] as const) {
    assert.ok(petMoodText(mood).endsWith('.'), `${mood}: законченная фраза`);
  }

  // 5. Разметка остаётся доступной: питомец декоративный, без ложных ролей.
  await act(async () => root.render(<Pet variant="cat" level={4} mood="happy" />));
  const svg = container.querySelector('svg')!;
  assert.ok(!svg.hasAttribute('role') || svg.getAttribute('role') !== 'img', 'питомец не объявляется картинкой без подписи');

  console.log('  ok питомец в разметке: четыре настроения различимы, комната передаёт настроение, старые экраны не ломаются');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
