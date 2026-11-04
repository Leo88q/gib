/**
 * Устаревшая вкладка и повторная отправка на живом сервере.
 *
 * Проверяем то, что реально происходит, когда ребёнок открыл миссию в двух
 * вкладках или нажал ответ дважды: второй ответ не должен ни дублировать
 * награду, ни ломать сессию, а `start` обязан вернуть актуальный шаг.
 *
 * Запуск: BASE=http://127.0.0.1:<порт> npx tsx scripts/test-stale-tab.ts
 */
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3000';

async function call(parent: string, path: string, body?: object) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-demo-parent': parent },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const parent = `stale-${Date.now()}`;
  const profile = await call(parent, '/api/profile', { name: 'Тест', age: 9 });
  const id = profile.data.profile.id;

  // 1. Открываем миссию и фиксируем шаг.
  const first = await call(parent, '/api/session', { action: 'start', profileId: id, storyChoice: true, journey: true });
  assert.equal(first.status, 200);
  const sessionId = first.data.sessionId;
  // Пока история не выбрана, отвечать нельзя — сервер это требует.
  assert.equal(first.data.storyOffer?.length > 0, true, 'сначала предлагается выбор истории');
  const blocked = await call(parent, '/api/session', { action: 'answer', sessionId, answer: { index: 0 }, step: 0, ms: 1000 });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'story_selection_required', 'ответ без выбора истории отклоняется');
  const picked = await call(parent, '/api/session', { action: 'select_story', sessionId, cardId: first.data.storyOffer[0].id });
  assert.equal(picked.status, 200, 'история выбрана');
  const started = await call(parent, '/api/session', { action: 'start', profileId: id, storyChoice: true, journey: true });
  assert.equal(started.status, 200);
  assert.equal(started.data.sessionId, sessionId, 'продолжается та же сессия');
  const step = started.data.step ?? 0;
  const before = (await call(parent, `/api/player?profileId=${id}`)).data.player;
  console.log('  ok миссия открыта, шаг и состояние игрока зафиксированы');

  // 2. Две одновременные отправки одного и того же ответа: награда не удваивается.
  const item = started.data.item;
  const answer = item?.type === 'scenario' ? { index: 0 } : { index: 0 };
  const [both1, both2] = await Promise.all([
    call(parent, '/api/session', { action: 'answer', sessionId, answer, step, ms: 1000 }),
    call(parent, '/api/session', { action: 'answer', sessionId, answer, step, ms: 1000 }),
  ]);
  assert.equal(both1.status, 200);
  assert.equal(both2.status, 200, 'повтор того же ответа — не ошибка');
  assert.equal(both2.data.reward?.xp, both1.data.reward?.xp, 'вторая отправка возвращает ту же награду, а не новую');
  assert.equal(both2.data.done, both1.data.done, 'и тот же результат');
  const after = (await call(parent, `/api/player?profileId=${id}`)).data.player;
  const gained = (after.xp ?? 0) - (before.xp ?? 0);
  assert.equal(gained, both1.data.reward?.xp ?? 0, 'за два одновременных запроса начислено один раз');
  console.log('  ok две одновременные отправки дают одну награду');

  // 3. Вторая вкладка повторила тот же ответ — это законный повтор, а не ошибка:
  //    ребёнок не должен получать сообщение об ошибке за двойное нажатие.
  const staleStep = step;
  const stale = await call(parent, '/api/session', { action: 'answer', sessionId, answer: { index: 0 }, step: staleStep, ms: 1000 });
  assert.equal(stale.status, 200, 'тот же ответ на прежний шаг — та же квитанция');
  assert.equal(stale.data.reward?.xp, both1.data.reward?.xp, 'без второй награды');
  console.log('  ok повтор того же ответа из второй вкладки не считается ошибкой');

  // 4. Другой ответ на тот же шаг — настоящий конфликт, а не повтор.
  const conflict = await call(parent, '/api/session', { action: 'answer', sessionId, answer: { index: 3 }, step: staleStep, ms: 1000 });
  assert.equal(conflict.status, 409, 'другой ответ на пройденный шаг — настоящий конфликт');
  assert.equal(conflict.data.error, 'step_conflict');
  console.log('  ok другой ответ на пройденный шаг отклоняется как конфликт');

  // 5. Восстановление: повторный start возвращает ту же сессию и актуальный шаг.
  const resumed = await call(parent, '/api/session', { action: 'start', profileId: id, storyChoice: true, journey: true });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.sessionId, sessionId, 'та же сессия');
  assert.ok((resumed.data.step ?? 0) > step || resumed.data.storyOffer, 'шаг сдвинулся вперёд или идёт выбор истории');
  const afterResume = (await call(parent, `/api/player?profileId=${id}`)).data.player;
  assert.equal(afterResume.xp, after.xp, 'восстановление не начисляет награду повторно');
  console.log('  ok повторный start возвращает актуальный шаг без второй награды');

  // 6. Чужой владелец не может ни прочитать, ни продолжить сессию.
  assert.equal((await call('foreign', '/api/session', { action: 'answer', sessionId, answer: { index: 0 }, step: 0 })).status, 404);
  assert.equal((await call('foreign', '/api/session', { action: 'start', profileId: id, storyChoice: true, journey: true })).status, 404);
  console.log('  ok чужой владелец получает 404 на чтение и продолжение');

  // 7. Отказ сети на клиенте: повторная отправка того же ответа — та же квитанция.
  const again = await call(parent, '/api/session', { action: 'answer', sessionId, answer, step, ms: 1000 });
  assert.equal(again.status, 200);
  assert.equal(again.data.reward?.xp, both1.data.reward?.xp, 'повтор после «потери ответа» не платит дважды');
  console.log('  ok повтор после потери ответа возвращает прежнюю квитанцию');

  console.log('  ok устаревшая вкладка: одна награда, 409 на конфликт, восстановление без дублей');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
