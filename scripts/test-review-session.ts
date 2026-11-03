import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, answerStep, selectSessionStory } from '../lib/engine/session';
import { reviewDayKeyFor } from '../lib/review/topics';
import type { Profile } from '../lib/types';

/**
 * Повторение внутри дня: отдельный заход по пройденной теме, без влияния на
 * прогресс программы, без второй награды и без принуждения.
 */

const DAY = 24 * 60 * 60 * 1000;

function memory(band: Profile['band'], age: number) {
  const profile: Profile = { id: 'p_r', parentId: 'owner_r', name: 'Т', age, band, createdAt: 1 };
  const mem = makeSessionMemory({
    profile, skills: [], sessions: [], playerStates: [],
    programStates: [{ profileId: profile.id, completedDays: 0, lastDayIndex: 0, startedAt: 1 }],
  });
  return { profile, mem };
}

/** Открывает день и выбирает историю, как это делает клиент. */
function playDay(mem: ReturnType<typeof memory>['mem'], profile: Profile) {
  const started = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
  const rt = mem.state.sessions.find(s => s.id === started.sessionId)!.runtime!;
  const chosen = selectSessionStory(started.sessionId, rt.storyOffer![0].id, mem.store);
  assert.ok('ok' in chosen, 'история выбрана');
  return started;
}

/** Отвечает на текущий шаг, пока сессия не завершится. */
function playToEnd(mem: ReturnType<typeof memory>['mem'], sessionId: string) {
  for (let guard = 0; guard < 20; guard++) {
    const session = mem.state.sessions.find(s => s.id === sessionId)!;
    const rt = session.runtime;
    if (!rt) return session;
    const item = rt.items[rt.index];
    const answer = item.type === 'scenario' ? { index: 0 } : item.instance.kind === 'social-practice' ? { skip: true } : item.instance.answer!;
    const res = answerStep(sessionId, answer as any, 0, rt.index, mem.store);
    if ('error' in res) throw Error(`${item.type === 'scenario' ? 'scenario' : item.instance.kind}: ${res.error}`);
  }
  throw Error('сессия не завершилась');
}

/* ------------------- 1. после дня тема получает срок ------------------- */
{
  const { profile, mem } = memory('8-10', 9);
  const started = playDay(mem, profile);
  const finishedSession = playToEnd(mem, started.sessionId);
  assert.ok(finishedSession.finishedAt, 'день завершён');

  const state = mem.state.programStates[0];
  assert.ok(Array.isArray(state.reviewStates) && state.reviewStates.length > 0, 'расписание повторения сохранено в состоянии программы');
  assert.equal(state.reviewStates![0].reviews, 0);

  // Сразу после дня повтор не предлагается — его срок ещё не наступил.
  const immediate = startSession(profile, false, mem.store, { review: true });
  assert.equal(immediate.review, undefined, 'раньше срока повтор не выдаётся');
  assert.ok(immediate.sessionId, 'вместо повтора открывается обычный день');
}

/* ------------------ 2. в срок повтор открывается отдельно ------------------ */
{
  const { profile, mem } = memory('11-13', 12);
  const started = playDay(mem, profile);
  playToEnd(mem, started.sessionId);

  const state = mem.state.programStates[0];
  state.reviewStates = state.reviewStates!.map(s => ({ ...s, dueAt: Date.now() - DAY }));
  const daysBefore = state.completedDays;

  const review = startSession(profile, false, mem.store, { review: true });
  assert.ok(review.review, 'повтор выдан');
  assert.equal(review.review!.topicId, state.reviewStates![0].topicId);
  assert.equal(review.steps, 1, 'в повторе один этап');
  assert.equal(review.storyOffer, undefined, 'в повторе нет выбора истории');
  assert.equal(mem.state.programStates[0].completedDays, daysBefore, 'повтор не двигает программу');
  const reviewSession = mem.state.sessions.find(s => s.id === review.sessionId)!;
  assert.deepEqual(reviewSession.runtime!.review, { topicId: review.review!.topicId });
  assert.equal(reviewSession.runtime!.advanceProgram, false);

  const before = mem.state.programStates[0].reviewStates!.find(s => s.topicId === review.review!.topicId)!;
  playToEnd(mem, review.sessionId);
  const after = mem.state.programStates[0].reviewStates!.find(s => s.topicId === review.review!.topicId)!;
  assert.equal(after.reviews, before.reviews + 1, 'повтор учтён в расписании');
  assert.ok((after.dueAt ?? 0) > Date.now(), 'следующий срок в будущем');
  assert.equal(mem.state.programStates[0].completedDays, daysBefore, 'повтор не засчитывает день программы');
  const again = startSession(profile, false, mem.store, { review: true });
  assert.equal(again.review, undefined, 'сразу после повтора новый не выдаётся');
}

/* ------------- 3. повтор — обычная сессия: награда не удваивается ------------- */
{
  const { profile, mem } = memory('5-7', 6);
  const started = playDay(mem, profile);
  playToEnd(mem, started.sessionId);
  const state = mem.state.programStates[0];
  state.reviewStates = state.reviewStates!.map(s => ({ ...s, dueAt: Date.now() - DAY }));
  const playerBefore = structuredClone(mem.state.playerStates[0]);

  const review = startSession(profile, false, mem.store, { review: true });
  const res = answerStep(review.sessionId, { index: 0 }, 0, 0, mem.store);
  assert.ok(!('error' in res), 'ответ в повторе принимается');
  assert.equal((res as any).done, true);
  const playerAfter = mem.state.playerStates[0];
  assert.ok(playerAfter.xp >= playerBefore.xp, 'награда за историю обычная, без «бонуса за повтор»');
  assert.equal(playerAfter.stars, playerBefore.stars, 'повтор не начисляет звёзд за день');
  // Повторная отправка того же ответа возвращает ту же квитанцию и не даёт второй награды.
  const xpAfter = playerAfter.xp;
  const coinsAfter = playerAfter.coins;
  const replay = answerStep(review.sessionId, { index: 0 }, 0, 0, mem.store);
  assert.ok(!('error' in replay), 'повтор того же ответа возвращает квитанцию');
  assert.deepEqual((replay as any).reward.xp, (res as any).reward.xp, 'квитанция идентична');
  assert.equal(mem.state.playerStates[0].xp, xpAfter, 'повтор шага не начисляет XP снова');
  assert.equal(mem.state.playerStates[0].coins, coinsAfter, 'монеты не начисляются снова');
  const different = answerStep(review.sessionId, { index: 1 }, 0, 0, mem.store);
  assert.equal((different as any).error, 'step_conflict', 'другой ответ на тот же шаг — конфликт');
}

/* ------------------ 4. отказ и пропуск не наказывают ------------------ */
{
  const { profile, mem } = memory('8-10', 9);
  const started = playDay(mem, profile);
  playToEnd(mem, started.sessionId);
  const state = mem.state.programStates[0];
  state.reviewStates = state.reviewStates!.map(s => ({ ...s, dueAt: Date.now() - DAY, reviews: 1 }));
  const review = startSession(profile, false, mem.store, { review: true });
  const before = { ...state.reviewStates![0] };
  const completedBefore = mem.state.programStates[0].completedDays;
  const xpBefore = mem.state.playerStates[0].xp;
  const starsBefore = mem.state.playerStates[0].stars;
  const daysBefore = mem.state.playerStates[0].stats.days;
  const skipped = answerStep(review.sessionId, {}, 0, 0, mem.store);
  assert.ok(!('error' in skipped), 'пустой ответ допустим как отказ от выбора');
  assert.equal((skipped as any).done, true, 'отказ завершает заход, а не блокирует его');
  const after = mem.state.programStates[0].reviewStates![0];
  assert.ok(after.reviews >= before.reviews, 'отказ не уменьшает прогресс');
  assert.equal(mem.state.playerStates[0].xp, xpBefore, 'за отказ награда не начисляется');
  assert.equal(mem.state.playerStates[0].stars, starsBefore, 'звёзды за отказ не начисляются');
  assert.equal(mem.state.playerStates[0].stats.days, daysBefore, 'день программы не засчитывается');
  // Программа уже продвинулась на этом профиле раньше — проверяем, что отказ её не двигает.
  assert.equal(mem.state.programStates[0].completedDays, completedBefore, 'программа не страдает');
  assert.equal(after.dueAt, null, 'после отказа тема не висит в списке');
}

/* ------------------ 4а. не больше одного повтора в день ------------------ */
{
  const { profile, mem } = memory('8-10', 9);
  const started = playDay(mem, profile);
  playToEnd(mem, started.sessionId);
  const state = mem.state.programStates[0];
  state.reviewStates = state.reviewStates!.map(s => ({ ...s, dueAt: Date.now() - DAY }));
  const first = startSession(profile, false, mem.store, { review: true });
  assert.ok(first.review, 'первый повтор за день выдан');
  assert.equal(mem.state.programStates[0].reviewDay, reviewDayKeyFor(profile), 'день повтора отмечен');
  playToEnd(mem, first.sessionId);
  const second = startSession(profile, false, mem.store, { review: true });
  assert.equal(second.review, undefined, 'второй повтор в тот же день не выдаётся');
  assert.ok(second.steps > 1, 'вместо него открывается обычный день');
  assert.equal(mem.state.programStates[0].reviewDay, reviewDayKeyFor(profile), 'обычный день не сбрасывает отметку');
}

/* --------------------- 5. сохранность старых состояний --------------------- */
{
  const { profile, mem } = memory('8-10', 9);
  const plain = startSession(profile, false, mem.store, { review: true });
  assert.equal(plain.review, undefined, 'без истории повторов нет');
  assert.equal(mem.state.sessions.length, 1);
  assert.deepEqual(mem.state.programStates[0].reviewStates ?? [], [], 'пустое расписание создаётся без ошибок');
}

console.log('  ok повторение в дне: отдельный заход, без прогресса программы и второй награды, отказ без наказания');
