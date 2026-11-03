/**
 * Сквозная проверка механики упражнений на движке сессии (изолированное
 * in-memory хранилище, фиктивные профили). Сервер не запускается.
 */
import assert from 'node:assert/strict';
import { startSession, answerStep, publicItem, selectSessionStory } from '../lib/engine/session.ts';
import { makeSessionMemory } from '../lib/postgres/session-memory.ts';
import { validateStore } from '../lib/store-validation.ts';
import { TASK_BY_ID } from '../lib/content/cognitive.ts';
import { taskPresentation } from '../lib/exercise/mechanics.ts';
import { levelCap } from '../lib/engine/adaptive.ts';
import type { AgeBand, Profile } from '../lib/types.ts';

const BANDS: [AgeBand, number][] = [['5-7', 6], ['8-10', 9], ['11-13', 12]];
const KINDS = ['choice', 'cards', 'gonogo', 'memory', 'symbol-memory', 'digits', 'finddiff', 'order', 'switch-rounds'] as const;

function task(item: any) { return item.instance; }

function payloads(item: any): { kind: string; good: any; bad: any[] } {
  if (item.type === 'scenario') {
    const count = item.variant.options.length;
    return {
      kind: 'scenario',
      good: { index: 0 },
      bad: [{}, { index: -1 }, { index: count }, { index: 0.5 }, { index: String(0) }, { index: 0, cells: [99] }, { index: 0, assisted: 'yes' }],
    };
  }
  const task = item.instance;
  const kind = task.kind;
  if (kind === 'social-practice') {
    return {
      kind,
      good: { cells: task.rounds.map(() => 0) },
      bad: [{ cells: [0, 0] }, { cells: [0, 0, 0, 0] }, { cells: [0, 0, 9] }, { cells: [0, 0, -1] }, { skip: true, cells: [0, 0, 0] }, { skip: 'yes' }, {}],
    };
  }
  if (kind === 'choice' || kind === 'cards') {
    return { kind, good: { index: 0 }, bad: [{}, { index: -1 }, { index: 1.5 }, { index: '0' }, { cells: [0] }] };
  }
  if (kind === 'memory' || kind === 'symbol-memory' || kind === 'finddiff') {
    return { kind, good: { cells: [0] }, bad: [{ cells: '0' }, { cells: [-1] }, { cells: [99] }, { cells: [0, 0] }, {}, { targets: [0] }] };
  }
  if (kind === 'gonogo') {
    return { kind, good: { targets: [] }, bad: [{ targets: [0, 0] }, { targets: [-1] }, { cells: [0] }, {}] };
  }
  if (kind === 'digits') {
    return { kind, good: { digits: '1' }, bad: [{ digits: '123456789' }, { digits: '1a' }, { digits: 1 }, { cells: [0] }, {}] };
  }
  if (kind === 'order') {
    const n = task.steps.length;
    return { kind, good: { cells: Array.from({ length: n }, (_, i) => i) }, bad: [{ cells: [0] }, { cells: Array(n).fill(0) }, { cells: Array.from({ length: n + 1 }, (_, i) => i) }, {}] };
  }
  if (kind === 'switch-rounds') {
    return { kind, good: { cells: task.rules.map(() => 0) }, bad: [{ cells: [0] }, { cells: [0, 9] }, { cells: task.rules.map(() => 0).concat(0) }, {}] };
  }
  throw Error(`неизвестный вид задания: ${kind}`);
}

const seen = new Map<AgeBand, Set<string>>();
let checks = 0;
const ok = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };

for (const [band, age] of BANDS) {
  const profile: Profile = { id: `p-${band}`, parentId: 'owner', name: 'Тест', age, band, createdAt: 1 };
  let mem = makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{ profileId: profile.id, completedDays: 0, lastDayIndex: 0, startedAt: 1 }] });
  const kinds = new Set<string>();
  for (let day = 0; day < 60; day++) {
    assert.equal(mem.state.programStates[0].completedDays, day, `${band}: дни идут по порядку`);
    const start = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
    ok(start.resumed === false, `${band}/${day}: новая миссия`);
    // Выбор истории обязателен до первого ответа.
    assert.deepEqual(answerStep(start.sessionId, { index: 0 }, 0, 0, mem.store), { error: 'story_selection_required' });
    checks++;
    const offer = mem.state.sessions[mem.state.sessions.length - 1].runtime!.storyOffer!;
    const card = offer[0];
    let selected: any;
    for (const candidate of offer) {
      const attempt = makeSessionMemory(structuredClone(mem.state));
      const result = selectSessionStory(start.sessionId, candidate.id, attempt.store);
      assert.deepEqual(result, { ok: true, cardId: candidate.id });
      checks++;
      if (candidate.id === card.id) selected = attempt;
    }
    mem = selected;
    const rt = mem.state.sessions[mem.state.sessions.length - 1].runtime!;
    for (let step = 0; step < rt.items.length; step++) {
      const item = publicItem(rt.items[step], band);
      const { kind, good, bad } = payloads(item);
      kinds.add(kind);
      // Некорректные ответы не меняют состояние и не начисляют награду.
      const before = JSON.stringify(mem.state.playerStates);
      for (const payload of bad) {
        const attempt = makeSessionMemory(structuredClone(mem.state));
        const res = answerStep(start.sessionId, payload, 1000, step, attempt.store);
        ok('error' in res && (res.error === 'invalid_answer' || res.error === 'step_conflict'), `${band}/день ${day + 1}/шаг ${step}/${kind}: некорректный ответ отклонён`);
        ok(JSON.stringify(attempt.state.playerStates) === before, `${band}/${kind}: некорректный ответ не начисляет награду`);
      }
      // Пропуск разрешён только для необязательной практики.
      if (kind === 'social-practice') {
        const attempt = makeSessionMemory(structuredClone(mem.state));
        const res = answerStep(start.sessionId, { skip: true }, 1000, step, attempt.store);
        ok(!('error' in res), `${band}/день ${day + 1}: пропуск практики принимается`);
        ok((res as any).evaluation === 'not_scored', 'пропуск практики не оценивается');
      } else {
        const attempt = makeSessionMemory(structuredClone(mem.state));
        assert.deepEqual(answerStep(start.sessionId, { skip: true } as any, 1000, step, attempt.store), { error: 'invalid_answer' });
        ok(JSON.stringify(attempt.state.playerStates) === before, `${band}/${kind}: пропуск когнитивного задания не подменяется наградой`);
      }
      // Верный/первый ответ принимается, повтор возвращает ту же квитанцию.
      const first = answerStep(start.sessionId, good, 1000, step, mem.store);
      ok(!('error' in first), `${band}/день ${day + 1}/шаг ${step}/${kind}: допустимый ответ принимается`);
      const retry = answerStep(start.sessionId, good, 1000, step, mem.store);
      assert.deepEqual(retry, first);
      checks++;
      // Другой ответ на тот же шаг — конфликт без второй награды.
      const conflictState = JSON.stringify(mem.state.playerStates);
      // Другой ответ на том же шаге: для истории — другой вариант, для практики — другой набор идей,
      // для остальных заданий отличие выражается только в отпечатке (assisted), как в текущем контракте.
      const alternative = kind === 'scenario' ? { index: 1 } : kind === 'social-practice' ? { cells: task(rt.items[step]).rounds.map((r: any, i: number) => (i + 1) % r.options.length) } : { ...good, assisted: true };
      const conflicting = answerStep(start.sessionId, alternative, 1000, step, mem.store);
      ok('error' in conflicting && conflicting.error === 'step_conflict', `${band}/${kind}: подмена ответа на том же шаге отклонена`);
      ok(JSON.stringify(mem.state.playerStates) === conflictState, `${band}/${kind}: конфликт не начисляет награду`);
      if (step === rt.items.length - 1) break;
      validateStore({ profiles: [profile], sessions: mem.state.sessions });
      checks++;
    }
    const finished = mem.state.sessions[mem.state.sessions.length - 1];
    assert.ok(finished.finishedAt, `${band}/${day + 1}: миссия завершена`);
    assert.equal(finished.runtime, undefined);
    checks += 2;
    // Активная сессия не осталась: следующий старт создаёт новую.
    mem = makeSessionMemory(structuredClone(mem.state));
  }
  seen.set(band, kinds);
}

for (const [band] of BANDS) {
  for (const kind of [...KINDS, 'scenario', 'social-practice']) {
    ok(seen.get(band)!.has(kind), `${band}: встретился вид «${kind}»`);
  }
}

/* ------------------ возрастные ограничения и представление ------------------ */
for (const [band] of BANDS) {
  for (const id of Object.keys(TASK_BY_ID)) {
    const def = TASK_BY_ID[id];
    const cap = levelCap(band, def.skill);
    for (let level = 1; level <= 6; level++) {
      const instance = def.make(Math.min(level, cap), band);
      if (instance.kind === 'memory' || instance.kind === 'finddiff') {
        ok((instance.rows ?? 3) <= (band === '5-7' ? 3 : 4), `${band}/${id}: размер поля по возрасту`);
        ok((instance.cells?.length ?? instance.cards?.length ?? 0) <= (band === '5-7' ? 9 : 16), `${band}/${id}: целей не больше поля`);
      }
      if (instance.kind === 'digits') ok((instance.digits?.length ?? 0) <= (band === '5-7' ? 3 : band === '8-10' ? 5 : 6), `${band}/${id}: длина ряда по возрасту`);
      if (instance.kind === 'order') ok((instance.steps?.length ?? 0) <= (band === '5-7' ? 4 : 5), `${band}/${id}: шагов плана по возрасту`);
      ok(!('answer' in instance) || Boolean(instance.answer), `${band}/${id}: ключ существует только на сервере`);
      ok(taskPresentation(instance.kind, band).instruction.length > 0, `${band}/${id}: инструкция есть`);
    }
  }
}

console.log(`Поток упражнений: 60 дней × 3 возраста, ${checks} проверок — некорректные ответы, пропуск только практики, повторы без второй награды, конфликты и возрастные границы`);
