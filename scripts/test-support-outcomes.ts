import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { Profile, AgeBand } from '../lib/types';
const bands: [AgeBand, number][] = [['5-7', 6], ['8-10', 9], ['11-13', 12]];
for (const [band, age] of bands) for (const cardId of ['day_1_default', 'day_1_music', 'day_1_picture']) {
  const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age, band, createdAt: 1 };
  const { state, store } = makeSessionMemory({ profile, skills: [], sessions: [], programStates: [], playerStates: [] });
  const start = startSession(profile, false, store, { storyChoice: true });
  assert.deepEqual(selectSessionStory(start.sessionId, cardId, store), { ok: true, cardId });
  const session = state.sessions[0];
  const scenarioId = start.storyOffer!.find(card => card.id === cardId)!.scenarioId;
  const practice = session.runtime!.items[3]; assert.equal(practice.type, 'task');
  assert.deepEqual(practice.instance, makeSupportPractice(band, scenarioId));
  for (let step = 0; step < 3; step++) {
    const item = session.runtime!.items[step];
    const answer = item.type === 'scenario' ? { index: 0 } : item.instance.answer!;
    assert.ok(!('error' in answerStep(start.sessionId, answer, 0, step, store)));
  }
  const snapshot = structuredClone(state);
  let baseline: { xp: number; coins: number; combo: number; correctStreak: number; tasks: number } | undefined;
  {
    const mem = makeSessionMemory(snapshot); const ses = mem.state.sessions[0]; const player = mem.state.playerStates[0];
    const xp = player.xp, coins = player.coins, skills = JSON.stringify(mem.state.skills), tasks = ses.runtime!.taskAnswers.length;
    assert.deepEqual(answerStep(start.sessionId, { skip: true, cells: [0,0,0] }, 0, 3, mem.store), { error: 'invalid_answer' });
    const result = answerStep(start.sessionId, { skip: true }, 0, 3, mem.store);
    assert.ok(!('error' in result)); assert.equal(result.evaluation, 'not_scored');
    assert.equal(player.xp - xp, 15); assert.equal(player.coins - coins, 5);
    assert.equal(JSON.stringify(mem.state.skills), skills); assert.equal(ses.runtime!.taskAnswers.length, tasks);
    assert.equal(ses.runtime!.supportPracticeCompleted, undefined);
    assert.deepEqual(answerStep(start.sessionId, { skip: true }, 0, 3, mem.store), result);
    assert.deepEqual(answerStep(start.sessionId, { cells: [0,0,0] }, 0, 3, mem.store), { error: 'step_conflict' });
    const next = ses.runtime!.items[4]; assert.equal(next.type, 'task');
    assert.deepEqual(answerStep(start.sessionId, { skip: true }, 0, 4, mem.store), { error: 'invalid_answer' });
    assert.ok(!('error' in answerStep(start.sessionId, next.instance.answer!, 0, 4, mem.store)));
    assert.equal(ses.supportPracticeCompleted, undefined);
  }
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
    const mem = makeSessionMemory(snapshot); const ses = mem.state.sessions[0]; const before = mem.state.playerStates[0];
    const beforeXp = before.xp, beforeCoins = before.coins, beforeSkills = JSON.stringify(mem.state.skills), beforeTasks = ses.runtime!.taskAnswers.length;
    const payload = { cells: [a, b, c] };
    const result = answerStep(start.sessionId, payload, 100, 3, mem.store);
    assert.ok(!('error' in result)); assert.equal(result.evaluation, 'not_scored');
    assert.equal(JSON.stringify(mem.state.skills), beforeSkills); assert.equal(ses.runtime!.taskAnswers.length, beforeTasks);
    const after = mem.state.playerStates[0];
    const outcome = { xp: after.xp - beforeXp, coins: after.coins - beforeCoins, combo: ses.runtime!.combo, correctStreak: ses.runtime!.correctStreak, tasks: ses.runtime!.taskAnswers.length };
    baseline ??= outcome; assert.deepEqual(outcome, baseline); assert.equal(outcome.xp, 15); assert.equal(outcome.coins, 5);
    assert.deepEqual(answerStep(start.sessionId, payload, 100, 3, mem.store), result);
    assert.deepEqual(answerStep(start.sessionId, { cells: [(a + 1) % 3, b, c] }, 100, 3, mem.store), { error: 'step_conflict' });
    const next = ses.runtime!.items[4]; assert.equal(next.type, 'task');
    assert.ok(!('error' in answerStep(start.sessionId, next.instance.answer!, 0, 4, mem.store)));
    assert.notEqual(ses.lastReceipt?.fingerprint, JSON.stringify([null, payload.cells, null, null]));
    assert.equal(ses.supportPracticeCompleted, true);
  }
}
console.log('  ok 3 сюжета × 3 возраста × 27 выборов: равная награда за прохождение или пропуск, отсутствие оценки и изменения навыков, повторы и замена квитанции');
