/**
 * Маршрут педагога: группа, код приглашения, отметки.
 *
 * Тест проверяет три вещи, которые легко сделать «через одно место»:
 *  1. Ребёнок попадает в группу только после ввода кода родителем. Без этого
 *     шага педагог мог бы добавить кого угодно по идентификатору.
 *  2. Педагог отмечает только детей своей группы. Знание profileId не помогает.
 *  3. Педагог не видит чужих групп и не получает в ответ ничего о ребёнке
 *     сверх имени, возраста и счётчиков.
 *
 * Плюс отказы, которые важнее функций: причина отсутствия не принимается,
 * сам себе педагог группу из одного не делает, чужой код не открывает группу.
 *
 * Запуск: npm run test:teacher-route
 */

import { strict as assert } from 'node:assert';
import { GET, POST, PUT } from '../app/api/teacher/route.ts';
import { store } from '../lib/store.ts';
import { buildSchedule } from '../lib/year/lessons.ts';
import { YEAR } from '../lib/content/year/index.ts';
import type { Profile } from '../lib/types.ts';

// Режим задаётся до первого запроса к хранилищу: иначе requireParent отвергнет
// демо-заголовок. Приведение к Record нужно, потому что NODE_ENV объявлен
// только для чтения, а демо-режим без него не включается.
(process.env as Record<string, string>).NODE_ENV = 'development';
process.env.GIB_DEMO_MODE = '1';

const req = (method: string, body?: unknown, parent = 'anna', url = 'http://localhost/api/teacher') => {
  const headers: Record<string, string> = { 'x-demo-parent': parent, 'content-type': 'application/json' };
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

const profile = (id: string, parent: string): Profile => ({
  id,
  parentId: `demo:${parent}`,
  name: `Ребёнок ${id}`,
  age: 9,
  band: '8-10',
  createdAt: Date.now(),
});

/** Ребёнок со своим расписанием: без него отметка не найдёт занятие. */
const withSchedule = (id: string, parent: string) => {
  const p = profile(id, parent);
  store.addProfile(p);
  const start = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  // Состояние берём существующее (его создаёт addProfile) и добавляем расписание:
  // полагаться на неполный объект с `as never` значит проверять выдуманные данные.
  const base = store.programState(p.id);
  store.setProgramState({
    ...base,
    profileId: p.id,
    startedAt: Date.parse(start),
    lessons: buildSchedule(YEAR, start),
  } as never);
  return p;
};

async function main() {
  /**
   * Чистое хранилище на каждый запуск. В общем прогоне до этого теста другие
   * тесты уже пишут в свой файл, а здесь проверяются права — им нужен известный
   * набор профилей, а не то, что осталось от соседей.
   */
  const { rmSync } = await import('node:fs');
  const dataFile = process.env.GIB_DATA_FILE;
  if (!dataFile || !dataFile.startsWith('/tmp/')) {
    throw new Error('GIB_DATA_FILE должен указывать в /tmp: тест не должен трогать рабочую базу');
  }
  rmSync(dataFile, { force: true });
  /* ---- 1. Создание группы ---- */

  let res = await json(await PUT(req('PUT', { name: '4Б' })));
  assert.equal(res.status, 200, `группа не создалась: ${JSON.stringify(res.body)}`);
  const group = res.body.group as { id: string; joinCode: string; name: string };
  assert.ok(group.id && group.joinCode, 'в ответе нет идентификатора или кода');
  assert.equal(group.joinCode.length, 8, 'код не 8 символов: его неудобно диктовать');
  console.log('  ok педагог создал группу и получил код');

  res = await json(await PUT(req('PUT', { name: '4Б', year: 1999 })));
  assert.equal(res.body.error, 'invalid_year', 'принят несуществующий год');
  res = await json(await PUT(req('PUT', { name: '' })));
  assert.equal(res.body.error, 'invalid_name', 'принято пустое название');
  res = await json(await PUT(req('PUT', { name: '4Б', hack: 1 })));
  assert.equal(res.body.error, 'unexpected_fields', 'лишнее поле принято молча');
  console.log('  ok мусор в названии, годе и лишних полях отвергается');

  /* ---- 2. Родитель вводит код ---- */

  const child = withSchedule(`p_route_${Date.now()}`, 'olga');

  res = await json(await POST(req('POST', { action: 'join', code: 'НЕВЕРНЫЙ', profileId: child.id }, 'olga')));
  assert.equal(res.body.error, 'invalid_code', 'принят код неверного формата');

  res = await json(await POST(req('POST', { action: 'join', code: 'ABCD2345', profileId: child.id }, 'olga')));
  assert.equal(res.body.error, 'group_not_found', 'чужой код открыл группу');

  res = await json(await POST(req('POST', { action: 'join', code: group.joinCode, profileId: child.id }, 'olga')));
  assert.equal(res.status, 200, `вход по коду не сработал: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.joined, true);
  assert.equal(res.body.group.name, '4Б');
  assert.equal(res.body.group.students, undefined, 'родителю отдан список других детей');
  console.log('  ok код открывает группу, а список других детей — нет');

  res = await json(await POST(req('POST', { action: 'join', code: group.joinCode.toLowerCase(), profileId: child.id }, 'olga')));
  assert.equal(res.body.error, 'already_member', 'двойное вступление создало дубль');

  res = await json(await POST(req('POST', { action: 'join', code: group.joinCode, profileId: child.id }, 'vlad')));
  assert.equal(res.body.error, 'profile_not_found', 'чужой ребёнок добавлен в группу');
  console.log('  ok код в нижнем регистре работает, чужой ребёнок не добавляется');

  /* ---- 3. Педагог видит группу ---- */

  res = await json(await GET(req('GET')));
  assert.equal(res.status, 200);
  const mine = (res.body.groups as { id: string; students: unknown[] }[]).find((g) => g.id === group.id);
  assert.ok(mine, 'своя группа не видна педагогу');
  assert.equal(mine.students.length, 1, `в группе ${mine.students.length} детей, ожидался 1`);
  const card = mine.students[0] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(card).sort(),
    // Новые поля — методические подсказки, не данные о ребёнке: ступень выхода,
  // приём и число отказов подряд. Ничего о содержании ответов и чувствах.
  ['age', 'attended', 'hint', 'missed', 'name', 'profileId', 'refusalsInRow', 'refused', 'showcases', 'stage'],
    `в карточке лишние поля: ${Object.keys(card).join(', ')}`,
  );
  console.log('  ok педагог видит одного ребёнка, в карточке только разрешённые поля');

  res = await json(await GET(req('GET', undefined, 'boris')));
  assert.deepEqual(res.body.groups, [], 'педагог без групп видит чужие группы');
  res = await json(await GET(req('GET', undefined, 'olga')));
  assert.deepEqual(res.body.groups, [], 'родитель увидел группы педагога');
  console.log('  ok чужие группы не видны никому');

  /* ---- 3.5. План встречи отдаётся педагогу ---- */

  res = await json(await GET(req('GET')));
  const plan = res.body.plan as { minutes: number; next: number | null; lessons: { lesson: number; blocks: unknown[]; closing: string }[] };
  assert.ok(plan, 'в ответе нет плана встречи: педагог не знает, что делать 40 минут');
  assert.equal(plan.minutes, 40, 'длина встречи не 40 минут');
  assert.equal(plan.lessons.length, 36, `в плане ${plan.lessons.length} занятий, ожидалось 36`);
  // Старт программы в тесте — 70 дней назад, то есть десять занятий уже прошли.
  // Ожидание «1» здесь было бы проверкой моей арифметики, а не кода.
  assert.equal(plan.next, 11, `следующее занятие ${plan.next}, ожидалось 11`);
  // Закрывающая фраза — та, которую можно сказать вслух. Родительский совет в
  // план не попадает: его прочитают группе.
  const closing = plan.lessons[0].closing;
  assert.ok(/Скажите вслух/.test(closing), `закрывающая фраза не для детей: ${closing.slice(0, 60)}`);
  assert.ok(!/Не ждите от него/.test(closing), 'в план попал совет родителю');

  console.log('  ok план на 36 занятий отдан, закрывающая фраза — для детей');

  /* ---- 3.6. Показ: шкала выхода ---- */

  // Занятие 4 в году — показ (первая тема: 4 занятия, последнее — показ).
  res = await json(await POST(req('POST', { action: 'showcase', profileId: child.id, lesson: 4, level: 1 })));
  assert.equal(res.status, 200, `отметка показа не прошла: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.level, 1);

  res = await json(await POST(req('POST', { action: 'showcase', profileId: child.id, lesson: 4, level: 3 })));
  assert.equal(res.body.error, 'invalid_showcase_level', 'уровень вне шкалы принят');
  assert.equal(res.body.anchors[0], 'Отказался после двух приглашений', 'якоря шкалы не отдаются');

  // Показ нельзя отметить на обычном занятии: это ошибка вызывающего, а не данные.
  res = await json(await POST(req('POST', { action: 'showcase', profileId: child.id, lesson: 2, level: 2 })));
  assert.equal(res.body.error, 'not_a_showcase', 'показ отмечен на обычном занятии');

  // Отказ принимается наравне с выходом.
  res = await json(await POST(req('POST', { action: 'showcase', profileId: child.id, lesson: 4, level: 0 })));
  assert.equal(res.status, 200, 'отказ не принят: отказ — это данные, а не ошибка ввода');
  assert.equal(res.body.showcase.refused, 1, 'отказ не попал в отдельный счётчик');
  assert.equal(res.body.showcase.shows, 0, 'отказ посчитан как выход');
  console.log('  ok показ: 0–2, якоря отдаются, отказ отдельным счётчиком, обычное занятие отвергается');

  /* ---- 4. Отметки ---- */

  res = await json(await POST(req('POST', { action: 'mark', profileId: child.id, lesson: 1, attended: true })));
  assert.equal(res.status, 200, `отметка не прошла: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.attended, true);

  res = await json(await POST(req('POST', { action: 'mark', profileId: child.id, lesson: 1, attended: true, reason: 'болел' })));
  assert.equal(res.body.error, 'reason_not_collected', 'причина отсутствия принята');

  res = await json(await POST(req('POST', { action: 'mark', profileId: child.id, lesson: 999, attended: true })));
  assert.equal(res.body.error, 'invalid_lesson', 'несуществующее занятие принято');

  // Форма проверяется до прав: запрос без attended не должен доходить до
  // проверки доступа. Поэтому посторонний педагог отправляет корректный запрос.
  res = await json(await POST(req('POST', { action: 'mark', profileId: child.id, lesson: 1, attended: true }, 'ivan')));
  assert.equal(res.body.error, 'profile_not_found', 'посторонний педагог отметил ребёнка');
  console.log('  ok отметка своей группы, причина отсутствия и чужой педагог отвергнуты');

  /* ---- 5. Сам себе педагог — не группа ---- */

  res = await json(await POST(req('POST', { action: 'join', code: group.joinCode, profileId: child.id }, 'anna')));
  assert.equal(res.body.error, 'profile_not_found', 'педагог добавил чужого ребёнка к себе');

  const ownChild = withSchedule(`p_own_${Date.now()}`, 'anna');
  res = await json(await POST(req('POST', { action: 'join', code: group.joinCode, profileId: ownChild.id }, 'anna')));
  assert.equal(res.body.error, 'own_group', 'педагог добавил своего ребёнка в свою же группу');
  console.log('  ok группа из одного человека запрещена');

  /* ---- 6. Выход из группы ---- */

  res = await json(await POST(req('POST', { action: 'leave', groupId: group.id, profileId: child.id }, 'olga')));
  assert.equal(res.body.left, true, 'выход из группы не сработал');

  res = await json(await GET(req('GET')));
  const afterLeave = (res.body.groups as { id: string; students: unknown[] }[]).find((g) => g.id === group.id);
  assert.equal(afterLeave?.students.length, 0, 'ребёнок остался в группе после выхода');
  console.log('  ok выход из группы убирает ребёнка из списка');

  /* ---- 7. Отметки переживают выход ---- */

  const state = store.programState(child.id);
  const first = state.lessons?.find((entry) => entry.lesson === 1);
  assert.equal(first?.attended, true, 'отметка пропала при выходе из группы: историю переписали');
  console.log('  ok отметка осталась после выхода: посещение было фактом');

  console.log('\nМаршрут педагога: группа по коду, отметки группы, без лишнего.');
}

main().catch((error) => { console.error(error); process.exit(1); });
