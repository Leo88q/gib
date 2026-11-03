/**
 * Повторение темы по HTTP на одноразовом loopback-сервере с SQLite.
 *
 * Требует сервер с `GIB_STORE=sqlite` и доступным файлом базы: срок повтора
 * сдвигается прямо в SQLite, как будто прошло несколько дней. Тест не входит в
 * `npm test`, потому что запускать сервер должен вызывающий.
 *
 * Запуск: BASE=http://127.0.0.1:3099 DB=/tmp/gib-ui.sqlite npx tsx scripts/test-review-http.ts
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const base = process.env.BASE ?? 'http://127.0.0.1:3099';
const dbFile = process.env.DB ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('нужен одноразовый числовой loopback-сервер');
if (!dbFile) throw Error('укажите DB — файл SQLite одноразового сервера');

const headers = { 'content-type': 'application/json', 'x-demo-parent': 'review-http-test' };
const post = async (path: string, body: object) => {
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const get = async (path: string) => {
  const res = await fetch(base + path, { headers });
  return { status: res.status, data: await res.json() };
};

/** Ответ, который сервер примет для текущего задания. */
function answerFor(item: any): object {
  if (!item) return { index: 0 };
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

/**
 * Сдвигает срок всех повторов в прошлое и снимает отметку «сегодня был повтор»
 * напрямую в базе сервера. Так тест можно запускать многократно на одном сервере.
 */
function expireReviews(profileId: string) {
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get() as { data: string };
    const state = JSON.parse(row.data);
    const program = state.programStates.find((p: any) => p.profileId === profileId);
    assert.ok(program, 'состояние программы найдено в базе');
    assert.ok((program.reviewStates ?? []).length > 0, 'у профиля есть расписание повторения');
    for (const review of program.reviewStates) review.dueAt = Date.now() - 86_400_000;
    delete program.reviewDay;
    db.prepare('UPDATE app_state SET data = ? WHERE id = 1').run(JSON.stringify(state));
  } finally { db.close(); }
}

async function main() {
  const created = await post('/api/profile', { name: 'Повтор', age: 9 });
  assert.equal(created.status, 200, 'профиль создаётся');
  const profileId = created.data.profile.id;

  /* ---------- 1. полный день ---------- */
  const start = await post('/api/session', { action: 'start', profileId, storyChoice: true, journey: true });
  assert.equal(start.status, 200);
  const sessionId = start.data.sessionId;
  const chosen = await post('/api/session', { action: 'select_story', sessionId, cardId: start.data.storyOffer[0].id });
  assert.equal(chosen.status, 200);
  let item = chosen.data.item;
  let step = chosen.data.step ?? 0;
  for (;;) {
    const res = await post('/api/session', { action: 'answer', sessionId, step, answer: answerFor(item), ms: 900 });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    if (!res.data.next) break;
    item = res.data.next; step += 1;
  }
  const afterDay = await get(`/api/session?profileId=${profileId}`);
  const daysAfterDay = afterDay.data.program.completedDays;
  assert.ok(daysAfterDay >= 1, 'день засчитан');
  assert.equal(afterDay.data.program.review, null, 'сразу после дня повтор не предлагается');

  /* ---------- 2. срок наступил ---------- */
  expireReviews(profileId);
  const due = await get(`/api/session?profileId=${profileId}`);
  const topic = due.data.program.review;
  assert.ok(topic && topic.title, 'повтор предложен с заголовком темы');
  const programRoute = await get(`/api/program?profileId=${profileId}`);
  assert.equal(programRoute.data.review?.topicId, topic.topicId, 'второй маршрут предлагает ту же тему');

  /* ---------- 3. отдельный заход ---------- */
  const review = await post('/api/session', { action: 'start', profileId, review: true, storyChoice: true, journey: true });
  assert.equal(review.status, 200);
  assert.equal(review.data.review.topicId, topic.topicId, 'выдана именно предложенная тема');
  assert.equal(review.data.steps, 1, 'в повторе один этап');
  assert.equal(review.data.storyOffer, undefined, 'в повторе нет выбора истории');

  const answered = await post('/api/session', { action: 'answer', sessionId: review.data.sessionId, step: 0, answer: { index: 0 }, ms: 800 });
  assert.equal(answered.status, 200);
  assert.equal(answered.data.done, true, 'повтор завершается одним ответом');
  // Награда за историю обычная, но «награды за день» и звёзд повтор не даёт.
  assert.ok(answered.data.reward.xp > 0 && answered.data.reward.coins > 0);

  /* ---------- 4. прогресс и правило одного повтора ---------- */
  const afterReview = await get(`/api/session?profileId=${profileId}`);
  assert.equal(afterReview.data.program.completedDays, daysAfterDay, 'повтор не двигает программу');
  assert.equal(afterReview.data.program.review, null, 'второй повтор в тот же день не предлагается');
  const second = await post('/api/session', { action: 'start', profileId, review: true, storyChoice: true, journey: true });
  assert.equal(Boolean(second.data.review), false, 'второй повтор не открывается');
  assert.ok(second.data.steps > 1, 'вместо него открылся обычный день');

  /* ---------- 5. повторная отправка не даёт второй награды ---------- */
  const replay = await post('/api/session', { action: 'answer', sessionId: review.data.sessionId, step: 0, answer: { index: 0 }, ms: 800 });
  assert.equal(replay.status, 200, 'повтор того же ответа возвращает квитанцию');
  assert.equal(replay.data.reward.xp, answered.data.reward.xp, 'вторая награда не начислена');
  const other = await post('/api/session', { action: 'answer', sessionId: review.data.sessionId, step: 0, answer: { index: 1 }, ms: 800 });
  assert.equal(other.status, 409, 'другой ответ на тот же шаг отклонён');

  /* ---------- 6. чужой профиль ---------- */
  const foreign = await fetch(base + `/api/session?profileId=${profileId}`, { headers: { ...headers, 'x-demo-parent': 'someone-else' } });
  assert.equal(foreign.status, 404, 'чужой владелец не видит чужой повтор');

  console.log('  ok повторение по HTTP: предложение в срок, отдельный заход, программа не двигается, один повтор в день');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
