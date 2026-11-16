/**
 * Карта умений в интерфейсе ребёнка: что он реально увидит и в каком виде.
 *
 * Проверяем не пиксели, а то, что легко сломать правкой вёрстки:
 *  1. до загрузки ничего не мигает, при ошибке есть повтор;
 *  2. умения, которых ещё не было, видны, но не выглядят как минус;
 *  3. на экране нет процентов, уровней и рейтингов;
 *  4. название умения берётся под возраст ребёнка, а не одно на всех.
 */
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import PracticeMap from '../components/PracticeMap';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://gib.test/' });
Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const payload = {
  topics: [{ id: 'empathy', title: 'Замечать других', stories: 1, practices: 1 }],
  skills: [
    {
      id: 'empathy', title: 'Замечать других', label: 'Замечать других', met: 1, total: 3,
      skills: [
        { id: 'read_signals', title: 'Читать сигналы', label: 'Заметить, что с другом что-то происходит', met: true, stories: 1 },
        { id: 'not_assume', title: 'Не додумывать', label: 'Спросить, а не угадывать', met: false, stories: 0 },
        { id: 'comfort_other', title: 'Поддержать словом', label: 'Сказать доброе слово', met: false, stories: 0 },
      ],
    },
    {
      id: 'self_awareness', title: 'Понимать себя', label: 'Понимать себя', met: 0, total: 2,
      skills: [
        { id: 'name_feelings', title: 'Называть чувства словами', label: 'Понять, что я сейчас чувствую', met: false, stories: 0 },
        { id: 'recognize_strengths', title: 'Свои сильные стороны', label: 'Заметить, что у меня получается', met: false, stories: 0 },
      ],
    },
  ],
  mood: { mood: 'moving', text: 'Встречалось 1 из 5 умений. Пропусков здесь нет — просто ещё не все истории пройдены.' },
  activity: { days: [], activeDays: 0, totalDays: 28, text: 'Пока ни одного занятия.' },
};

let calls = 0;
(globalThis as any).fetch = async (url: string) => {
  calls++;
  assert.match(url, /^\/api\/practice-map\?profileId=p$/);
  // Первый запрос — ошибка, чтобы проверить повтор; второй — данные.
  if (calls === 1) return new Response('{}', { status: 500 });
  return new Response(JSON.stringify(payload), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);

async function main() {
  /* ---- 1. Ошибка загрузки и повтор ---- */
  await act(async () => { root.render(<PracticeMap profileId="p" />); });
  assert.ok(container.textContent?.includes('Не удалось загрузить карту'), 'при сбое видно сообщение');
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Попробовать'));
  assert.ok(retry, 'есть кнопка повтора');
  await act(async () => { retry!.click(); });
  assert.equal(calls, 2, 'повтор действительно ходит в сеть');

  /* ---- 2. Умения появились, включая непройденные ---- */
  const text = container.textContent ?? '';
  assert.ok(text.includes('Понимать себя'), 'вторая тема видна');
  // Умения лежат внутри свёрнутой темы: ребёнок открывает её сам. Наружу
  // видно название темы и счётчики, а подробности появляются по нажатию.
  assert.ok(text.includes('1 из 5') || /1\s*из\s*5/.test(text), 'счётчик встреч виден');
  assert.ok(container.querySelector('.skills-level'), 'блок умений отрисован');
  assert.equal(container.querySelectorAll('.skills-group').length, 2, 'по теме на каждую компетенцию');
  // До раскрытия списки свёрнуты: 48 названий сразу — стена текста.
  assert.equal(text.includes('Заметить, что у меня получается'), false, 'до раскрытия умения не вываливаются');
  assert.ok(/Замечать других2?1 из 3|1 из 3/.test(text.replace(/\s+/g, ' ')), 'счётчик встреч виден');

  /* ---- 3. Нейтральность: нет «слабо», «отстаёшь», процентов ---- */
  // «слабо», «отстаёшь» и проценты — прямая оценка. Слова «уровень» и
  // «рейтинг» запрещены как сущности, но в тексте «это не оценка и не
  // рейтинг» они допустимы: там их как раз отрицают.
  for (const word of ['слаб', 'отста', 'провал', 'не освоен', '%']) {
    assert.equal(text.toLowerCase().includes(word), false, `на экране не должно быть «${word}»`);
  }
  for (const phrase of ['твой уровень', 'уровень развития', 'в рейтинге', 'место в рейтинге']) {
    assert.equal(text.toLowerCase().includes(phrase), false, `на экране не должно быть «${phrase}»`);
  }

  /* ---- 4. Раскрытие: по умолчанию список закрыт, после нажатия — открыт ---- */
  const head = container.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
  assert.ok(head, 'у темы есть кнопка раскрытия');
  assert.equal(head!.getAttribute('aria-expanded'), 'false', 'по умолчанию тема свёрнута');
  await act(async () => { head!.click(); });
  assert.equal(head!.getAttribute('aria-expanded'), 'true', 'после нажатия тема раскрыта');
  assert.ok((container.textContent ?? '').includes('Заметить, что с другом что-то происходит'), 'раскрытая тема показывает умения');

  /* ---- 5. Отметка встречи без числа успеха ---- */
  assert.ok(container.querySelector('.skills-list li.met'), 'встреченное умение отмечено классом');
  const metItem = container.querySelector('.skills-list li.met')!;
  assert.equal(/молодец|отлично|лучший/i.test(metItem.textContent ?? ''), false, 'отметка не хвалит ребёнка');

  await act(async () => root.unmount());
  dom.window.close();
  console.log('  ok карта умений: сбой и повтор, непройденное видно, раскрытие, без оценок');
}

void main();
