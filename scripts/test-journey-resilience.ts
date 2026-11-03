/**
 * Устойчивость этапов миссии через настоящий HTTP: воспроизведение уже
 * отправленного шага, отказ перешагнуть шаг, конфликт другого ответа,
 * восстановление после «перезагрузки» клиента и отсутствие второй награды.
 *
 * Требует одноразовый dev-сервер с тестовой БД (см. docs/integration-laboratory.md):
 *   GIB_STORE=sqlite GIB_SQLITE_FILE=/tmp/…sqlite GIB_DEMO_MODE=1 npx next dev -p 3096 -H 127.0.0.1
 *   BASE=http://127.0.0.1:3096 npm run test:journey-resilience
 * Никогда не запускать против production: там API закрыт 503, но данные всё равно боевые.
 */
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://127.0.0.1:3096';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'journey-resilience-test' };

type Reply = { status: number; data: any };
async function post(path: string, body: object): Promise<Reply> {
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function get(path: string): Promise<Reply> {
  const res = await fetch(base + path, { headers });
  return { status: res.status, data: await res.json() };
}
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('нужен одноразовый числовой loopback-сервер');

/** Ответ, который сервер примет для текущего задания. */
function answerFor(item: any): object {
  if (!item) throw Error('нет задания для ответа');
  if (item.type === 'scenario') return { index: 0 };
  const x = item.instance;
  switch (x.kind) {
    case 'choice': case 'cards': return { index: 0 };
    case 'switch-rounds': return { cells: x.rules.map(() => 0) };
    case 'order': return { cells: x.steps.map((_: string, i: number) => i) };
    case 'digits': return { digits: String(x.digits?.[0] ?? 1).repeat(x.digits?.length ?? 1) };
    case 'memory': case 'symbol-memory': return { cells: [...(x.cells ?? [0])] };
    case 'finddiff': return { cells: [0] };
    case 'gonogo': return { targets: [] };
    case 'social-practice': return { skip: true };
    default: throw Error(`неизвестный вид задания: ${x.kind}`);
  }
}

async function main() {
  const created = await post('/api/profile', { name: 'Устойчивость', age: 9 });
  assert.equal(created.status, 200, 'профиль создаётся');
  const profileId = created.data.profile.id;

  const first = await post('/api/session', { action: 'start', profileId, repeat: false, storyChoice: true, journey: true });
  assert.equal(first.status, 200, 'миссия открывается');
  const sessionId = first.data.sessionId;
  let item = first.data.item;
  let step = first.data.step;
  // В новой сессии сначала выбирается история — как в клиенте.
  if (Array.isArray(first.data.storyOffer) && first.data.storyOffer.length) {
    const chosen = await post('/api/session', { action: 'select_story', sessionId, cardId: first.data.storyOffer[0].id });
    assert.equal(chosen.status, 200, 'история выбирается');
    item = chosen.data.item;
    step = chosen.data.step ?? 0;
  }

  /* 1. Шаг вперёд без ответа невозможен: пропуск шага отклоняется. */
  const skipped = await post('/api/session', { action: 'answer', sessionId, step: step + 1, answer: answerFor(item) });
  assert.equal(skipped.status, 409, 'ответ с номером будущего шага отклонён');
  assert.equal(skipped.data.error, 'step_conflict');

  /* 2. Устаревшая вкладка: ответ на уже пройденный шаг с другим содержимым. */
  const answered = await post('/api/session', { action: 'answer', sessionId, step, answer: answerFor(item) });
  assert.equal(answered.status, 200, 'текущий шаг принимается');
  // Сервер не помнит старые шаги: неизвестный номер отклоняется как некорректный,
  // но никогда не засчитывается как новый ответ. Оба варианта безопасны.
  const past = await post('/api/session', { action: 'answer', sessionId, step: Math.max(0, step - 1), answer: { index: 0 } });
  assert.ok(past.status === 409 || past.status === 400, 'ответ на прошедший шаг отклонён');
  assert.ok(past.data.error === 'step_conflict' || past.data.error === 'invalid_answer', 'причина отказа явная');

  /* 3. Повтор запроса после потери ответа: тот же шаг, тот же ответ — та же квитанция. */
  const replay = await post('/api/session', { action: 'answer', sessionId, step, answer: answerFor(item) });
  assert.equal(replay.status, 200, 'повтор уже принятого шага отвечает 200');
  assert.deepEqual(replay.data, answered.data, 'повтор возвращает ту же квитанцию, а не новую награду');

  /* 4. Тот же шаг, но другой ответ — конфликт, а не тихая перезапись. */
  const different = JSON.stringify(answerFor(item)) === JSON.stringify({ index: 1 }) ? { index: 0 } : { index: 1 };
  if (item?.type !== 'scenario' && item?.instance?.kind === 'choice') {
    const conflict = await post('/api/session', { action: 'answer', sessionId, step, answer: different });
    assert.equal(conflict.status, 409, 'другой ответ на тот же шаг отклонён');
  }

  /* 5. «Перезагрузка» клиента: повторный start возвращает ту же сессию и тот же шаг. */
  const resumed = await post('/api/session', { action: 'start', profileId, storyChoice: true, journey: true });
  assert.equal(resumed.status, 200, 'миссия восстанавливается');
  assert.equal(resumed.data.sessionId, sessionId, 'это та же сессия');
  assert.equal(resumed.data.resumed, true, 'сессия помечена как продолженная');
  assert.equal(resumed.data.step, answered.data.next ? (answered.data.step ?? step) + 1 : step, 'шаг продолжается, а не начинается заново');

  /* 6. Награда не начисляется дважды: повтор всей пары «ответ + повтор». */
  const before = await get(`/api/player?profileId=${profileId}`);
  await post('/api/session', { action: 'answer', sessionId, step, answer: answerFor(item) });
  await post('/api/session', { action: 'answer', sessionId, step, answer: answerFor(item) });
  const after = await get(`/api/player?profileId=${profileId}`);
  assert.equal(before.data.player.xp, after.data.player.xp, 'опыт не изменился от повторной отправки');
  assert.equal(before.data.player.coins, after.data.player.coins, 'монеты не изменились от повторной отправки');

  /* 7. Чужой владелец не видит сессию и не может её продолжить. */
  const strangerHeaders = { ...headers, 'x-demo-parent': 'someone-else' };
  const foreign = await fetch(base + '/api/session', {
    method: 'POST', headers: strangerHeaders,
    body: JSON.stringify({ action: 'answer', sessionId, step, answer: answerFor(item) }),
  });
  assert.equal(foreign.status, 404, 'чужая сессия недоступна');

  /* 8. Некорректный ответ не засчитывается и не меняет шаг. */
  const malformed = await post('/api/session', { action: 'answer', sessionId, step: 99, answer: { cells: 'нет' } });
  assert.ok(malformed.status === 400 || malformed.status === 409, 'мусорный запрос отклонён');

  const cleanup = await fetch(`${base}/api/profile?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE', headers });
  assert.equal(cleanup.status, 200, 'тестовый профиль удаляется');
  console.log('  ok устойчивость этапов: пропуск шага, устаревшая вкладка, повтор без второй награды, восстановление, чужой владелец');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
