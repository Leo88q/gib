import assert from 'node:assert/strict';
import { createEventJournal, validateEvent, dedupeKeyFor, EVENT_VERSION } from '../lib/events/journal';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session';
import type { AgeBand, Profile } from '../lib/types';

/**
 * Каталог событий: допустимые типы и поля, отказ на лишние данные,
 * дедупликация одного шага, изоляция владельцев и удаление вместе с профилем.
 * Журнал в памяти — это контракт и проверка, а не production-хранилище.
 */

/* ------------------------- 1. схема события ------------------------- */
assert.deepEqual(validateEvent({ v: EVENT_VERSION, type: 'task_answered', taskKind: 'choice', correct: true, assisted: false, ms: 1200 }).ok, true);
assert.deepEqual(validateEvent({ v: EVENT_VERSION, type: 'practice_answered', skipped: true }).ok, true);
assert.deepEqual(validateEvent({ v: EVENT_VERSION, type: 'session_started', dayIndex: 0, repeat: false, journey: true }).ok, true);

// Тип вне каталога и неверная версия отклоняются.
assert.equal((validateEvent({ v: 1, type: 'child_said_something', text: 'привет' }) as any).error, 'unknown_type');
assert.equal((validateEvent({ v: 2, type: 'practice_answered', skipped: true }) as any).error, 'invalid_field');
// Лишние поля не отбрасываются молча: утечка должна быть видна.
assert.equal((validateEvent({ v: 1, type: 'task_answered', taskKind: 'choice', correct: true, assisted: false, ms: 10, name: 'Миша' }) as any).error, 'invalid_field');
assert.equal((validateEvent({ v: 1, type: 'task_answered', taskKind: 'choice', correct: true, assisted: false, ms: 10, answer: [1, 2] }) as any).error, 'invalid_field');
// Свободный текст в идентификаторе карточки не пройдёт.
assert.equal((validateEvent({ v: 1, type: 'story_selected', cardId: 'Привет, меня зовут Миша', offerSize: 3 }) as any).error, 'invalid_field');
// Числовые диапазоны ограничены.
assert.equal((validateEvent({ v: 1, type: 'session_completed', steps: 3, correct: 3, stars: 9, seconds: 10 }) as any).error, 'invalid_field');
assert.equal((validateEvent({ v: 1, type: 'task_answered', taskKind: 'choice', correct: true, assisted: false, ms: 999_999 }) as any).error, 'invalid_field');
assert.equal((validateEvent({ v: 1, type: 'session_started', dayIndex: 60, repeat: false, journey: true }) as any).error, 'invalid_field');
assert.equal((validateEvent(null) as any).error, 'invalid_event');
assert.equal((validateEvent([1, 2]) as any).error, 'invalid_event');

/* --------------------- 2. дедупликация и изоляция --------------------- */
const journal = createEventJournal(10);
const key = dedupeKeyFor('s_abc', 2, 'answer');
assert.equal(key, 's_abc:2:answer');
assert.equal(dedupeKeyFor('s abc', 2, 'answer'), '', 'мусорный идентификатор сессии не даёт ключ');

const event = { v: 1 as const, type: 'task_answered' as const, taskKind: 'choice', correct: true, assisted: false, ms: 800 };
const first = journal.append('owner-a', 'p1', key, event, 1000);
assert.ok(first.ok);
// Повтор того же шага возвращает первое событие и не создаёт второе.
const repeat = journal.append('owner-a', 'p1', key, event, 2000);
assert.ok(repeat.ok && first.ok && repeat.stored.id === first.stored.id, 'повтор не создаёт второе событие');
assert.equal(journal.size(), 1);
// Подмена профиля под тем же ключом отклоняется.
assert.equal((journal.append('owner-a', 'p2', key, event) as any).error, 'duplicate_key');
// Чужой владелец не читает чужие события.
assert.equal(journal.list('owner-b', 'p1').length, 0);
assert.equal(journal.list('owner-a', 'p1').length, 1);
// Удаление профиля убирает его события и освобождает ключи.
assert.equal(journal.removeProfile('p1'), 1);
assert.equal(journal.size(), 0);
assert.ok(journal.append('owner-a', 'p1', key, event).ok, 'после удаления тот же ключ снова доступен');

/* ------------------- 3. журнал заполняется движком ------------------- */
for (const [band, age] of [['5-7', 6], ['8-10', 9], ['11-13', 12]] as [AgeBand, number][]) {
  const profile: Profile = { id: `p-${band}`, parentId: 'owner-test', name: 'Тест', age, band, createdAt: 1 };
  const mem = makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{ profileId: profile.id, completedDays: 0, lastDayIndex: 0, startedAt: 1 }] });
  const trace = createEventJournal();
  mem.store.journal = trace;
  mem.store.ownerId = 'owner-test';
  const started = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
  const events = () => trace.list('owner-test', profile.id);
  assert.equal(events().length, 1, 'старт сессии создаёт одно событие');
  assert.equal(events()[0].event.type, 'session_started');
  assert.equal((events()[0].event as any).dayIndex, 0);

  const offer = mem.state.sessions[0].runtime!.storyOffer!;
  selectSessionStory(started.sessionId, offer[0].id, mem.store);
  assert.equal(events().at(-1)!.event.type, 'story_selected', 'выбор истории отмечен');
  // Повтор выбора не создаёт второе событие.
  const before = events().length;
  selectSessionStory(started.sessionId, offer[0].id, mem.store);
  assert.equal(events().length, before, 'идемпотентный повтор выбора не дублирует событие');

  answerStep(started.sessionId, { index: 0 }, 0, 0, mem.store);
  assert.equal(events().at(-1)!.event.type, 'story_answered');

  answerStep(started.sessionId, { skip: true }, 0, 1, mem.store);
  assert.equal(events().at(-1)!.event.type, 'practice_answered');
  assert.equal((events().at(-1)!.event as any).skipped, true);

  const rt = mem.state.sessions[0].runtime!;
  for (let step = 2; step < rt.items.length; step++) {
    const item = rt.items[step];
    if (item.type !== 'task') throw Error('ожидалось задание');
    const before = events().length;
    const last = rt.items.length - 1;
    answerStep(started.sessionId, item.instance.answer!, 0, step, mem.store);
    // На последнем шаге движок пишет и ответ, и завершение сессии.
    const tail = events().slice(before).map(e => e.event.type);
    if (step === last) assert.ok(tail.includes('session_completed'), 'последний шаг завершает сессию событием');
    const answerEvent = events().slice(before).find(e => e.event.type === 'task_answered' || e.event.type === 'practice_answered');
    assert.ok(answerEvent, 'ответ записан событием');
    if (item.instance.kind === 'social-practice') assert.equal(answerEvent!.event.type, 'practice_answered');
    else assert.equal(answerEvent!.event.type, 'task_answered');
    // Повтор шага не добавляет событие (кроме завершения: на последнем шаге их два — ответ и итог).
    answerStep(started.sessionId, item.instance.answer!, 0, step, mem.store);
    assert.equal(events().length, before + tail.length, 'повтор шага не создаёт второе событие');
  }
  const types = events().map(e => e.event.type);
  assert.ok(types.includes('session_completed'), 'завершение сессии отмечено');
  assert.ok(!JSON.stringify(events()).match(/Радость|радость|чувств|initData|Миша/), 'в журнале нет отметок чувств, имён и initData');
  // События принадлежат владельцу профиля.
  assert.ok(events().every(e => e.ownerId === 'owner-test' && e.profileId === profile.id));
  // Удаление профиля очищает журнал.
  const removed = trace.removeProfile(profile.id);
  assert.ok(removed > 0 && trace.list('owner-test', profile.id).length === 0, 'события удаляются вместе с профилем');
}

console.log('  ok журнал событий: схема без лишних полей, дедупликация шага, изоляция владельцев, очистка с профилем');
