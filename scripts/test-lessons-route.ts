/**
 * Отметки посещения занятий: контракт, права, и что маршрут отказывается делать.
 *
 * Почему не только HTTP-тест. HTTP требует живого сервера и потому в общий
 * прогон не входит; тогда поломка маршрута обнаруживается на проде. Здесь
 * обработчик вызывается напрямую, как в `test:data-summary-route`.
 *
 * Что проверяется:
 *  1. Без `profileId` — 400, чужой профиль — 404 (неотличимо от удалённого).
 *  2. GET создаёт расписание один раз и не пересчитывает его.
 *  3. POST ставит отметку и меняет сводку.
 *  4. Отметка на несуществующее занятие — 404.
 *  5. Причина отсутствия отвергается с отдельным кодом: `reason_not_collected`.
 *  6. Любые лишние поля отвергаются: `unexpected_fields`.
 *  7. Отметка одного взрослого не видна другому.
 *
 * Запуск: npm run test:lessons-route
 */
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/lessons/route.ts';
import { store } from '../lib/store.ts';
import { YEAR } from '../lib/content/year/index.ts';

const LESSON_COUNT = YEAR.total;

function get(parent: string, profileId?: string) {
  const query = profileId === undefined ? '' : `?profileId=${encodeURIComponent(profileId)}`;
  return new Request(`http://127.0.0.1/api/lessons${query}`, {
    headers: { 'x-demo-parent': parent },
  });
}

function post(parent: string, body: Record<string, unknown>) {
  return new Request('http://127.0.0.1/api/lessons', {
    method: 'POST',
    headers: { 'x-demo-parent': parent, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    GIB_DEMO_MODE: process.env.GIB_DEMO_MODE,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    MAX_BOT_TOKEN: process.env.MAX_BOT_TOKEN,
  };
  (process.env as Record<string, string>).NODE_ENV = 'development';
  process.env.GIB_DEMO_MODE = '1';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.MAX_BOT_TOKEN;

  const stamp = Date.now();
  const parent = `lessons-${stamp}`;
  const other = `lessons-other-${stamp}`;

  try {
    // В демо-режиме владелец — `demo:<имя>`, как в test:data-summary-route.
    // Иначе профиль не принадлежит вызывающему, и все проверки прав дадут 404.
    const profile: import('../lib/types.ts').Profile = {
      id: `p_lessons_${stamp}`,
      parentId: `demo:${parent}`,
      name: 'Тест',
      age: 9,
      band: '8-10',
      timeZone: 'Europe/Moscow',
      createdAt: Date.now(),
    };
    store.addProfile(profile);
    // Второй профиль нужен, чтобы проверить чужие права.
    store.addProfile({
      id: `p_lessons_other_${stamp}`,
      parentId: `demo:${other}`,
      name: 'Чужой',
      age: 9,
      band: '8-10',
      createdAt: Date.now(),
    });

    /* ---- 1. Права ---- */
    assert.equal((await GET(get(parent))).status, 400, 'без profileId должен быть 400');
    assert.equal((await GET(get(parent, 'нет-такого'))).status, 404, 'несуществующий профиль — 404');
    assert.equal((await GET(get(other, profile.id))).status, 404, 'чужой профиль — 404, а не 403');
    console.log('  ok 400 без профиля, 404 на чужой и несуществующий');

    /* ---- 2. GET: расписание создаётся один раз ---- */
    const first = await GET(get(parent, profile.id));
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.lessons.length, LESSON_COUNT, `занятий ${firstBody.lessons.length}, ожидалось ${LESSON_COUNT}`);
    assert.equal(firstBody.total, LESSON_COUNT);
    assert.equal(firstBody.attendance.attended, 0);
    assert.equal(firstBody.attendance.share, undefined, 'при отсутствии отметок доля должна быть неизвестна, а не 0');
    assert.ok(firstBody.next, 'следующее занятие не определено');

    const storedDates = firstBody.lessons.map((l: { date: string }) => l.date);
    const second = await (await GET(get(parent, profile.id))).json();
    assert.deepEqual(second.lessons.map((l: { date: string }) => l.date), storedDates, 'расписание пересчиталось при повторном открытии');
    console.log('  ok расписание из 36 дат создаётся один раз и не пересчитывается');

    /* ---- 2b. Страница занятия для родителя ---- */

    /**
     * Родителю уходит «что тренируем, как это видно в жизни». Проверяется
     * граница: результат ФГОС остаётся у педагога и завуча. В родительском
     * ответе он читался бы как оценка ребёнка — это ровно то, чего в продукте
     * быть не должно.
     */
    const page = firstBody.page;
    assert.ok(page, 'к расписанию не приложена страница занятия');
    assert.equal(page.lesson, firstBody.next.lesson, 'страница не про ближайшее занятие');
    assert.ok(page.trained.length > 10, 'не сказано, что тренируем');
    assert.ok(Array.isArray(page.examples) && page.examples.length >= 2, 'меньше двух примеров из жизни');
    for (const example of page.examples) {
      assert.ok(example.where && example.what, 'пример без места или действия');
    }
    assert.ok(page.noticeAtHome.length > 30, 'нет наблюдения для дома');
    assert.deepEqual(
      Object.keys(page).sort(),
      ['examples', 'lesson', 'noticeAtHome', 'trained'],
      `родителю уходит лишнее поле: ${Object.keys(page).join(', ')}`,
    );
    assert.equal(page.fgosWording, undefined, 'формулировка ФГОС не должна уходить родителю');
    assert.equal(page.seconds, undefined, 'служебные поля не должны уходить родителю');
    console.log('  ok страница занятия: 4 поля, ФГОС и служебное родителю не уходят');

    /* ---- 3. Права на отметку ---- */
    const foreign = await POST(post(other, { profileId: profile.id, lesson: 1, attended: true }));
    assert.equal(foreign.status, 404, 'чужой не должен отмечать занятия');
    console.log('  ok чужой взрослый не может отметить занятие');

    /* ---- 4. Отметка ---- */
    const marked = await POST(post(parent, { profileId: profile.id, lesson: 1, attended: true }));
    assert.equal(marked.status, 200);
    const markedBody = await marked.json();
    assert.equal(markedBody.lesson, 1);
    assert.equal(markedBody.attended, true);

    const afterMark = await (await GET(get(parent, profile.id))).json();
    assert.equal(afterMark.lessons[0].attended, true, 'отметка не сохранилась');
    console.log('  ok отметка ставится и сохраняется');

    /* ---- 5. Несуществующее занятие ---- */
    const bad = await POST(post(parent, { profileId: profile.id, lesson: LESSON_COUNT + 1, attended: true }));
    assert.equal(bad.status, 404, 'отметка на несуществующее занятие должна быть 404');
    console.log('  ok занятие вне года отвергается');

    /* ---- 6. Причина отсутствия ---- */
    const reason = await POST(post(parent, { profileId: profile.id, lesson: 2, attended: false, reason: 'болел' }));
    assert.equal(reason.status, 400, 'причина отсутствия не должна приниматься');
    assert.equal((await reason.json()).error, 'reason_not_collected', 'нужен отдельный код, а не общая ошибка валидации');
    console.log('  ok причина отсутствия отвергается отдельным кодом');

    /* ---- 7. Лишние поля ---- */
    const extra = await POST(post(parent, { profileId: profile.id, lesson: 2, attended: false, score: 5 }));
    assert.equal(extra.status, 400, 'лишние поля не должны приниматься');
    assert.equal((await extra.json()).error, 'unexpected_fields');
    console.log('  ok лишние поля отвергаются, а не отбрасываются молча');

    /* ---- 8. Битые тела ---- */
    assert.equal((await POST(post(parent, { profileId: profile.id, lesson: 0, attended: true }))).status, 400, 'занятие 0');
    assert.equal((await POST(post(parent, { profileId: profile.id, lesson: 1, attended: 'да' }))).status, 400, 'строка вместо булева');
    assert.equal((await POST(post(parent, { lesson: 1, attended: true }))).status, 400, 'без profileId');
    console.log('  ok битые тела отвергаются с 400');
  } finally {
    (process.env as Record<string, string>).NODE_ENV = previous.NODE_ENV ?? 'test';
    if (previous.GIB_DEMO_MODE === undefined) delete process.env.GIB_DEMO_MODE;
    else process.env.GIB_DEMO_MODE = previous.GIB_DEMO_MODE;
    if (previous.TELEGRAM_BOT_TOKEN !== undefined) process.env.TELEGRAM_BOT_TOKEN = previous.TELEGRAM_BOT_TOKEN;
    if (previous.MAX_BOT_TOKEN !== undefined) process.env.MAX_BOT_TOKEN = previous.MAX_BOT_TOKEN;
  }

  console.log('\nЗанятия года: права, отметки, отказ от причин.');
}

void main();
