import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import LessonCalendar from '../components/LessonCalendar';

/**
 * Календарь занятий в кабинете родителя: что видно, что нажимается и чего нет.
 *
 * Проверяется не вёрстка, а обещания, которые нельзя нарушать:
 *  1. видны даты, следующее занятие и сводка;
 *  2. отметка уходит на сервер и обновляет сводку;
 *  3. причина отсутствия не запрашивается и не показывается;
 *  4. нет ни балла, ни «успеваемости» — посещаемость не оценка ребёнка;
 *  5. сбой загрузки объяснён, а не проглочен.
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

type Entry = { lesson: number; date: string; attended: boolean | null; unit: number | null; title: string; isShowcase: boolean };
type Payload = { lessons: Entry[]; attendance: { held: number; attended: number; missed: number; unmarked: number; share?: number }; next: Entry | null; total: number };

const entry = (lesson: number, date: string, attended: boolean | null = null): Entry => ({
  lesson,
  date,
  attended,
  unit: Math.min(12, Math.ceil(lesson / 3)),
  title: 'Тема',
  isShowcase: lesson % 3 === 0,
});

function makePayload(): Payload {
  const lessons = Array.from({ length: 36 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index * 7)).toISOString().slice(0, 10);
    // Первые два занятия отмечены: одно посещено, одно пропущено.
    if (index === 0) return entry(index + 1, date, true);
    if (index === 1) return entry(index + 1, date, false);
    return entry(index + 1, date);
  });
  return {
    lessons,
    attendance: { held: 3, attended: 1, missed: 1, unmarked: 1, share: 0.5 },
    next: lessons[3],
    total: 36,
  };
}

let payload = makePayload();
let failLoad = false;
const marks: { lesson: number; attended: boolean }[] = [];
let rejectReason = false;

(globalThis as any).fetch = async (url: string, init?: { method?: string; body?: string }) => {
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    marks.push({ lesson: body.lesson, attended: body.attended });
    if (rejectReason) {
      return new Response(JSON.stringify({ error: 'reason_not_collected' }), { status: 400 });
    }
    const target = payload.lessons.find((item) => item.lesson === body.lesson);
    if (target) target.attended = body.attended;
    return new Response(JSON.stringify({ lesson: body.lesson, attended: body.attended, attendance: payload.attendance }), { status: 200 });
  }
  assert.ok(String(url).startsWith('/api/lessons?profileId='), `календарь по профилю: ${url}`);
  if (failLoad) return new Response('{}', { status: 500 });
  return new Response(JSON.stringify(payload), { status: 200 });
};

const container = dom.window.document.getElementById('app')!;
const root = createRoot(container);
const text = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

async function render(key = 'a') {
  await act(async () => {
    root.render(<LessonCalendar key={key} profileId="p" />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function main() {
  await render();

  /* ---- 1. Даты и сводка ---- */
  assert.ok(text().includes('Занятия: 36 за год'), 'общее число занятий названо');
  // Следующее занятие — четвёртое по счёту: первые три уже прошли по календарю.
  assert.ok(text().includes('22.09.2026'), `дата следующего занятия не показана: ${text().slice(0, 200)}`);
  assert.ok(text().includes('Прошло занятий'), 'сводка по прошедшим есть');
  assert.ok(text().includes('1 был · 1 не был'), 'отметки в сводке посчитаны');
  console.log('  ok даты, следующее занятие и сводка видны');

  /* ---- 2. Список раскрывается ---- */
  assert.ok(!container.querySelector('.lesson-list'), 'список не должен быть раскрыт сразу');
  button('Показать все 36 дат').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await act(async () => {});
  assert.ok(container.querySelector('.lesson-list'), 'список не раскрылся');
  assert.equal(container.querySelectorAll('.lesson-list .plan').length, 36, 'в списке не 36 занятий');
  console.log('  ok все 36 дат открываются по кнопке');

  /* ---- 3. Отметка ---- */
  const markButton = button('был');
  markButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(marks.length, 1, 'отметка не отправлена');
  assert.equal(marks[0].attended, true, 'отправлено не «был»');
  console.log('  ok отметка уходит на сервер');

  /* ---- 4. Причина отсутствия ---- */
  rejectReason = true;
  button('не был').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.ok(text().includes('не собираем'), 'отказ сохранять причину не объяснён');
  rejectReason = false;
  console.log('  ok отказ сохранять причину объяснён');

  /* ---- 5. Нет оценок ---- */
  // Запрещено не слово «оценка» (оно нужно в отрицании «это не оценка»), а
  // выставление оценки: балла, уровня, рейтинга, процента успешности.
  assert.ok(!/успеваемост/i.test(text()), 'слово «успеваемость» про ребёнка недопустимо');
  assert.ok(!/\bбалл|рейтинг|уровень развития/i.test(text()), 'баллов и рейтингов быть не должно');
  assert.ok(text().includes('не оценка ребёнка'), 'сказано, что посещаемость — не оценка');
  assert.ok(!/причин/i.test(text()) || text().includes('не записываем'), 'причина не запрашивается');
  assert.ok(!container.querySelector('input[type="text"]'), 'поля для причины нет');
  console.log('  ok нет оценок, нет поля для причины');

  /* ---- 6. Сбой загрузки ---- */
  failLoad = true;
  await render('b');
  assert.ok(text().includes('Не удалось загрузить'), 'сбой загрузки не объяснён');
  console.log('  ok сбой загрузки объяснён');

  console.log('\nКалендарь занятий: даты, отметки, отказ от причин, без оценок.');
}

void main();
