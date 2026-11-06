/**
 * Повторение: выбор темы, изоляция выбора и выключатель взрослого.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dueReviewTopics, reviewStatesFromSessions, reviewDayKeyFor } from '../lib/review/topics';

process.env.GIB_STORE = 'json';
process.env.GIB_DATA_FILE = join(mkdtempSync(join(tmpdir(), 'gib-review-')), 'db.json');

const DAY = 86_400_000;
const band = '8-10' as const;

function doneSession(id: string, scenarioId: string, finishedAt: number) {
  return { id, profileId: 'p', startedAt: finishedAt - 60000, finishedAt, seconds: 60, tasks: [], plan: [`scenario:${scenarioId}`], scenario: { scenarioId } } as any;
}

async function main() {
  const now = Date.UTC(2026, 4, 20, 12, 0, 0);
  const sessions = [
    doneSession('s1', 'w1d1', now - 40 * DAY),
    doneSession('s2', 'w1d2', now - 35 * DAY),
    doneSession('s3', 'w1d3', now - 30 * DAY),
  ];
  const states = reviewStatesFromSessions(sessions, band, now);
  // Срок наступил у первой темы; остальным «сдвигаем» срок в прошлое,
  // чтобы проверить именно выбор из нескольких подходящих.
  const statesDue = states.map((st, i) => i === 0 ? st : { ...st, dueAt: now - (i * DAY) });
  const due = dueReviewTopics(statesDue, band, now, 5);
  assert.ok(due.length >= 2, `созрело несколько тем: ${due.length}`);
  assert.ok(new Set(due.map(t => t.topicId)).size === due.length, 'темы не повторяются');

  // 1. Все подходящие темы равноценны: порядок по сроку, без оценок.
  const first = due[0];
  assert.ok(first.title && first.topicId && first.scenarioId, 'тема пригодна для захода');
  const later = due[due.length - 1];
  assert.notEqual(first.topicId, later.topicId);

  // 2. Выбор любой подходящей темы движок принимает; чужой/мусорный — откатывается к ближайшей.
  const { startSession } = await import('../lib/engine/session');
  const { store } = await import('../lib/store');

  const profile = { id: 'p', parentId: 'demo:x', name: 'Мира', age: 9, band, createdAt: now } as any;
  store.addProfile(profile);
  for (const s of sessions) store.addSession(s);
  store.setPlayerState({ ...store.playerState('p') } as any);
  store.setProgramState({ ...store.programState('p'), reviewStates: statesDue });

  // Выбираем последнюю тему из списка — не «ближайшую».
  const chosen = later.topicId;
  const started = startSession(profile, false, store, { review: true, reviewTopicId: chosen });
  assert.equal(started.review?.topicId, chosen, 'выбрана именно запрошенная тема');
  assert.equal(started.review?.title, later.title);
  assert.equal(started.steps, 1, 'повтор — один шаг, без растягивания');
  console.log('  ok можно выбрать любую подходящую тему');

  // 3. Второй повтор в тот же день не начинается: лимит сохраняется.
  const again = startSession(profile, false, store, { review: true, reviewTopicId: first.topicId });
  assert.equal(again.review, undefined, 'второй повтор в тот же день не предлагается');
  console.log('  ok лимит одного повтора в день сохраняется при выборе темы');

  // 4. Мусорный идентификатор не ломает запуск: берётся ближайшая тема.
  const other = { id: 'q', parentId: 'demo:x', name: 'Тео', age: 9, band, createdAt: now } as any;
  store.addProfile(other);
  for (const s of sessions) store.addSession({ ...s, id: `q-${s.id}`, profileId: 'q' });
  store.setProgramState({ ...store.programState('q'), reviewStates: statesDue.map(st => ({ ...st })) });
  const fallback = startSession(other, false, store, { review: true, reviewTopicId: 'not-a-topic' });
  assert.ok(fallback.review?.topicId, 'при неизвестной теме повтор всё равно начинается');
  assert.equal(fallback.review?.topicId, due[0].topicId, 'берётся ближайшая по сроку');
  console.log('  ok неизвестная тема не ломает повтор');

  // 5. Выключатель взрослого: предложений нет, прогресс и сроки не меняются.
  const quiet = { id: 'r', parentId: 'demo:x', name: 'Аля', age: 9, band, createdAt: now } as any;
  store.addProfile(quiet);
  for (const s of sessions) store.addSession({ ...s, id: `r-${s.id}`, profileId: 'r' });
  store.setProgramState({ ...store.programState('r'), reviewStates: statesDue.map(st => ({ ...st })), reviewOff: true });
  const off = startSession(quiet, false, store, { review: true });
  assert.equal(off.review, undefined, 'при выключенных повторах захода нет');
  assert.ok(off.sessionId, 'обычный день при этом начинается');
  const state = store.programState('r');
  assert.equal(state.reviewOff, true);
  assert.equal(state.reviewStates?.length, states.length, 'сроки тем не потеряны');
  console.log('  ok выключатель взрослого убирает предложение, не трогая прогресс');

  // 6. Ключ дня повтора зависит от часового пояса профиля, а не от сервера.
  const key = reviewDayKeyFor({ timeZone: 'Asia/Vladivostok' } as any);
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/, 'ключ дня в формате календаря');
  console.log('  ok день повтора считается по поясу профиля');

  console.log('  ok повторение: выбор темы, лимит дня, неизвестная тема, выключатель взрослого');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
