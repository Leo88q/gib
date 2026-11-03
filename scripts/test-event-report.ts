import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStoreJournal } from '../lib/events/store-journal';
import { buildEventReport, REPORT_LIMITS } from '../lib/events/report';
import { createEventJournal, EVENT_RETENTION_DAYS } from '../lib/events/journal';
import { validateStore } from '../lib/store-validation';

/**
 * Отчёт поверх журнала и постоянное хранение событий.
 *
 * Проверяем:
 * 1. отчёт считает только завершённые занятия и исключает подсказанные задания;
 * 2. у каждого числа есть источник, а ограничения перечислены явно;
 * 3. журнал переживает перезапуск процесса (файл JSON + SQLite);
 * 4. события удаляются вместе с профилем и по сроку хранения;
 * 5. чужие события не попадают в отчёт и в хранилище не подменяются.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function fakeStore() {
  const state = { events: [] as any[] };
  let depth = 0;
  return {
    state,
    transaction<T>(fn: () => T): T { depth++; try { return fn(); } finally { depth--; } },
    all: () => ({ events: state.events }),
    get depth() { return depth; },
  };
}

/* --------------------- 1. отчёт по завершённым занятиям --------------------- */
{
  const journal = createEventJournal();
  const push = (key: string, event: any, at = NOW - DAY) => journal.append('owner', 'p1', key, event, at);
  // Не завершённая сессия: её ответы не должны всё равно считаться работой.
  push('s_open:0:start', { v: 1, type: 'session_started', dayIndex: 1, repeat: false, journey: false });
  push('s_open:1:answer', { v: 1, type: 'task_answered', taskKind: 'choice', taskSkill: 'attention', correct: true, assisted: false, ms: 900 });
  // Завершённая сессия.
  push('s_1:0:start', { v: 1, type: 'session_started', dayIndex: 0, repeat: false, journey: true });
  push('s_1:2:story', { v: 1, type: 'story_selected', cardId: 'w1d1', offerSize: 3 });
  push('s_1:2:answer', { v: 1, type: 'story_answered', choiceIndex: 1, itemCount: 6 });
  push('s_1:3:answer', { v: 1, type: 'task_answered', taskKind: 'choice', taskSkill: 'attention', correct: true, assisted: false, ms: 800 });
  push('s_1:3:answer_gonogo', { v: 1, type: 'task_answered', taskKind: 'gonogo', taskSkill: 'inhibition', correct: false, assisted: false, ms: 400 });
  // Подсказанное задание: считается работой, но не влияет на точность.
  push('s_1:4:answer', { v: 1, type: 'task_answered', taskKind: 'finddiff', taskSkill: 'attention', correct: true, assisted: true, ms: 3000 });
  push('s_1:5:answer', { v: 1, type: 'practice_answered', skipped: true });
  push('s_1:5:complete', { v: 1, type: 'session_completed', steps: 3, correct: 1, stars: 2, seconds: 600 });
  // Просроченное событие старше срока хранения (в отчёт не входит по окну отчёта вообще).
  push('s_old:0:start', { v: 1, type: 'session_started', dayIndex: 0, repeat: false, journey: false }, NOW - 30 * DAY);
  push('s_old:5:complete', { v: 1, type: 'session_completed', steps: 5, correct: 5, stars: 3, seconds: 900 }, NOW - 30 * DAY);
  // Чужой профиль под тем же владельцем не попадает в отчёт p1.
  journal.append('owner', 'p2', 's_2:0:start', { v: 1, type: 'session_started', dayIndex: 0, repeat: false, journey: false }, NOW - DAY);

  const report = buildEventReport(journal, 'owner', 'p1', { now: NOW, days: 7 });
  assert.equal(report.student.sessions, 1, 'считаются только завершённые занятия');
  assert.equal(report.student.minutes, 10, 'минуты из завершённого занятия');
  assert.equal(report.student.stars, 2);
  assert.equal(report.student.tasks, 4, 'все ответы на задания');
  assert.equal(report.student.excludedTasks, 1, 'подсказанное задание исключено из точности');
  assert.equal(report.student.stories, 1);
  assert.equal(report.student.practices, 1);
  assert.equal(report.student.skippedPractices, 1);
  // Внимание: два верных обычных ответа + один подсказанный (исключён) → 2 из 2, исключён 1.
  const attention = report.skills.find(s => s.skill === 'attention')!;
  assert.deepEqual({ accuracy: attention.accuracy, tasks: attention.tasks, excluded: attention.excluded }, { accuracy: 1, tasks: 2, excluded: 1 });
  const inhibition = report.skills.find(s => s.skill === 'inhibition')!;
  assert.equal(inhibition.accuracy, 0, 'ошибка снижает точность');
  assert.equal(report.skills.find(s => s.skill === 'logic')!.accuracy, null, 'без данных — null, а не ноль');
  // Источники перечислены, ограничения на месте.
  assert.ok(report.sources.some(s => s.event === 'task_answered' && s.records === 4));
  assert.ok(report.sources.some(s => s.event === 'session_completed' && s.records === 1));
  assert.deepEqual(report.limits, [...REPORT_LIMITS]);
  // В отчёте нет содержимого ответов, отметок чувств и имён.
  const asText = JSON.stringify(report);
  // (ограничения намеренно упоминают «отметки чувств» — ищем содержимое, а не слово).
  assert.ok(!/Миша|initData|Радость|"text":|"note":/.test(asText));
  // Чужой владелец видит пустой отчёт.
  const foreign = buildEventReport(journal, 'owner-b', 'p1', { now: NOW });
  assert.equal(foreign.student.sessions, 0);
  assert.equal(foreign.sources.length, 0);
}

/* ------------------ 2. постоянный журнал в хранилище ------------------ */
{
  const store = fakeStore();
  let owned = new Set(['p1']);
  const journal = createStoreJournal(store, { persistOk: (_owner, profile) => owned.has(profile) });
  const event = { v: 1 as const, type: 'task_answered' as const, taskKind: 'choice', taskSkill: 'attention' as const, correct: true, assisted: false, ms: 700 };
  assert.ok(journal.append('owner', 'p1', 's_1:1:answer', event).ok);
  assert.equal(store.state.events.length, 1, 'событие лежит в хранилище, а не только в памяти');
  // Повтор не дублирует и не меняет идентификатор.
  const again = journal.append('owner', 'p1', 's_1:1:answer', event);
  assert.ok(again.ok && store.state.events.length === 1 && again.stored.id === store.state.events[0].id);
  // Чужой профиль за того же владельца не принимается.
  const foreign = journal.append('owner', 'p9', 's_9:1:answer', event);
  assert.equal((foreign as any).error, 'invalid_event');
  // Чужой владелец читает пусто.
  assert.equal(journal.list('owner-b', 'p1').length, 0);
  // Новый экземпляр поверх того же хранилища видит прежние события (как после рестарта процесса).
  const afterRestart = createStoreJournal(store);
  assert.equal(afterRestart.list('owner', 'p1').length, 1, 'журнал переживает «перезапуск»');
  assert.equal(afterRestart.append('owner', 'p1', 's_1:1:answer', event).ok, true, 'дедупликация сохраняется после рестарта');
  assert.equal(store.state.events.length, 1);
  // Удаление профиля чистит журнал.
  assert.equal(afterRestart.removeProfile('p1'), 1);
  assert.equal(store.state.events.length, 0);
}

/* ------------- 3. срок хранения и настоящие файлы хранилища ------------- */
{
  const store = fakeStore();
  const journal = createStoreJournal(store);
  const old = { v: 1 as const, type: 'profile_created' as const, band: '8-10' as const };
  journal.append('owner', 'p1', 'p1:0:created', old, NOW - (EVENT_RETENTION_DAYS + 1) * DAY);
  journal.append('owner', 'p1', 'p1:1:created', old, NOW - DAY);
  assert.equal(journal.prune(NOW), 1, 'просроченное событие удаляется');
  assert.equal(store.state.events.length, 1);

  // Реальный SQLite-файл: запись переживает закрытие и повторное открытие.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-events-'));
  const file = path.join(dir, 'db.sqlite');
  const script = `
    const { store } = require('${path.resolve('lib/store.ts')}');
  `;
  void script; // сам скрипт запускается ниже отдельным процессом
  const child = (env: Record<string, string>, code: string) => {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    // tsx (а не голый node) — он разрешает импорты без расширений внутри lib/.
    const tsx = path.resolve('node_modules/.bin/tsx');
    return execFileSync(tsx, ['-e', code], { env: { ...process.env, ...env }, encoding: 'utf8' });
  };
  const writeCode = `
    const { store } = require('${path.resolve('lib/store.ts')}');
    const { createStoreJournal } = require('${path.resolve('lib/events/store-journal.ts')}');
    const profile = { id: 'p_sql', parentId: 'owner_sql', age: 9, band: '8-10', createdAt: 1 };
    store.transaction(() => { store.addProfile(profile); });
    const journal = createStoreJournal(store);
    journal.append('owner_sql', 'p_sql', 's_sql:0:start', { v: 1, type: 'session_started', dayIndex: 0, repeat: false, journey: false });
    console.log(journal.list('owner_sql', 'p_sql').length);
  `;
  const readCode = `
    const { store } = require('${path.resolve('lib/store.ts')}');
    const { createStoreJournal } = require('${path.resolve('lib/events/store-journal.ts')}');
    const journal = createStoreJournal(store);
    const events = journal.list('owner_sql', 'p_sql');
    // Повторная запись того же ключа после рестарта не создаёт дубль.
    const again = journal.append('owner_sql', 'p_sql', 's_sql:0:start', { v: 1, type: 'session_started', dayIndex: 0, repeat: false, journey: false });
    console.log(JSON.stringify({ count: events.length, type: events[0]?.event.type, again: again.ok }));
  `;
  const env: Record<string, string> = { GIB_STORE: 'sqlite', GIB_SQLITE_FILE: file, NODE_OPTIONS: '' };
  const first = child(env, writeCode).trim().split('\n').pop();
  assert.equal(first, '1', 'событие записано в SQLite');
  const second = JSON.parse(child(env, readCode).trim().split('\n').pop() as string);
  assert.deepEqual(second, { count: 1, type: 'session_started', again: true }, 'событие переживает перезапуск процесса, дубля нет');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ------------------ 4. валидация хранилища отклоняет мусор ------------------ */
{
  const base = { profiles: [], skills: [], sessions: [], subs: [], programStates: [], playerStates: [], payments: [] };
  const good = { ...base, events: [{ id: 'e_1', profileId: 'p1', ownerId: 'o1', at: 1, dedupeKey: 'k1', event: { v: 1, type: 'profile_created', band: '8-10' } }] };
  assert.doesNotThrow(() => validateStore(good));
  // Лишнее поле внутри события (например, текст ответа) не проходит проверку хранилища.
  const leaked = { ...base, events: [{ ...good.events[0], event: { ...good.events[0].event, text: 'ребёнок сказал' } }] };
  assert.throws(() => validateStore(leaked), /Invalid event/);
  // Два события с одним ключом идемпотентности — ошибка хранилища.
  const duplicated = { ...base, events: [good.events[0], { ...good.events[0], id: 'e_2' }] };
  assert.throws(() => validateStore(duplicated), /Duplicate store identity: events/);
  // Отсутствие коллекции — совместимость со старыми снимками.
  assert.doesNotThrow(() => validateStore(base));
}

console.log('  ok отчёт по событиям: только завершённые занятия, источники и ограничения; журнал переживает рестарт');
