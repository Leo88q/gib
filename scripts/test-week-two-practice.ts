import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { answerStep, publicItem, startSession, selectSessionStory } from '../lib/engine/session';
import { makeSupportPractice } from '../lib/content/support-practice';
import { validateStore } from '../lib/store-validation';
import type { AgeBand, Profile } from '../lib/types';

for (const [band, age] of [['5-7', 6], ['8-10', 9], ['11-13', 12]] as [AgeBand, number][]) for (let day = 5; day <= 9; day++) {
  const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age, band, createdAt: 1 };
  const create = () => makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{profileId:'p', completedDays:day, lastDayIndex:day-1, startedAt:1}] });
  const old = create(); const legacy = startSession(profile, false, old.store);
  assert.ok(!old.state.sessions[0].plan.includes('support-practice')); assert.equal(legacy.steps, day === 9 ? 5 : 4);
  const mem = create(); const started = startSession(profile, false, mem.store, { storyChoice:true });
  if (day <= 9) { assert.ok((started.storyOffer?.length??0)>=2 && (started.storyOffer?.length??0)<=3); assert.deepEqual(selectSessionStory(started.sessionId, `day_${day+1}_default`, mem.store),{ok:true,cardId:`day_${day+1}_default`}); } else assert.equal(started.storyOffer, undefined);
  assert.equal(started.steps, day === 9 ? 6 : 5);
  let session = mem.state.sessions[0]; const story = session.runtime!.items[2];
  assert.equal(story.type, 'scenario'); assert.equal(story.scenarioId, `w2d${day-4}`);
  const practice = session.runtime!.items[3]; assert.equal(practice.type, 'task');
  assert.deepEqual(practice.instance, makeSupportPractice(band, `w2d${day-4}`));
  assert.ok(!JSON.stringify(publicItem(practice, band)).includes('"answer"'));
  for (let step = 0; step < 3; step++) {
    const item = session.runtime!.items[step];
    assert.ok(!('error' in answerStep(started.sessionId, item.type === 'scenario' ? {index: 0} : item.instance.answer!, 0, step, mem.store)));
  }
  const restarted = makeSessionMemory(mem.state); session = restarted.state.sessions[0];
  const resumed = startSession(profile, false, restarted.store, { storyChoice:true });
  assert.equal(resumed.step, 3); assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.item, publicItem(practice, band));
  assert.ok(!session.runtime!.practiceSteps?.includes(3));
  validateStore({profiles:[profile], sessions:restarted.state.sessions, playerStates:restarted.state.playerStates});
  const invalid = structuredClone(restarted.state.sessions[0]);
  const invalidPlan = invalid.runtime!.plan.find(p => p.type === 'task' && p.taskId === 'support-practice');
  assert.ok(invalidPlan && invalidPlan.type === 'task'); invalidPlan.practiceScenarioId = 'w4d1';
  assert.throws(() => validateStore({profiles:[profile], sessions:[invalid]}), /Invalid support practice association/);
  const legacySession = structuredClone(restarted.state.sessions[0]);
  const legacyPlan = legacySession.runtime!.plan.find(p => p.type === 'task' && p.taskId === 'support-practice');
  assert.ok(legacyPlan && legacyPlan.type === 'task'); delete legacyPlan.practiceScenarioId;
  validateStore({profiles:[profile], sessions:[legacySession]});

  const snapshot = structuredClone(restarted.state);
  for (const payload of [{skip: true as const}, ...Array.from({length:27}, (_,i) => ({cells:[Math.floor(i/9), Math.floor(i/3)%3, i%3]}))]) {
    const working = makeSessionMemory(snapshot), saved = working.state.sessions[0], player = working.state.playerStates[0];
    const xp = player.xp, coins = player.coins, skills = JSON.stringify(working.state.skills), taskCount = saved.runtime!.taskAnswers.length;
    const result = answerStep(started.sessionId, payload, 100, 3, working.store);
    assert.ok(!('error' in result)); assert.equal(result.evaluation, 'not_scored');
    assert.equal(player.xp-xp, 15); assert.equal(player.coins-coins, 5); assert.equal(JSON.stringify(working.state.skills), skills);
    assert.equal(saved.runtime!.taskAnswers.length, taskCount);
    assert.deepEqual(answerStep(started.sessionId, payload, 100, 3, working.store), result);
    for (let step=4; step<started.steps; step++) {
      const item = saved.runtime!.items[step]; assert.equal(item.type, 'task');
      assert.ok(!('error' in answerStep(started.sessionId, item.instance.answer!, 0, step, working.store)));
    }
    assert.ok(saved.finishedAt); assert.equal(saved.supportPracticeCompleted, 'skip' in payload ? undefined : true);
  }
}
console.log('  ok 5 дней × 3 возраста × 27 вариантов и пропуск: снимки, старые клиенты, возобновление и неоцениваемые награды');
{
  const profile: Profile = { id:'repeat', parentId:'owner', name:'Тест', age:9, band:'8-10', createdAt:1 };
  const mem = makeSessionMemory({ profile, skills:[], sessions:[], playerStates:[], programStates:[{profileId:'repeat', completedDays:6, lastDayIndex:5, startedAt:1}] });
  const repeat = startSession(profile, true, mem.store, {storyChoice:true});
  const saved = mem.state.sessions[0]; assert.equal(saved.runtime!.advanceProgram,false);
  assert.deepEqual(selectSessionStory(repeat.sessionId,'day_6_default',mem.store),{ok:true,cardId:'day_6_default'});
  for (let i=0; i<repeat.steps; i++) {
    const item = saved.runtime!.items[i];
    const payload = item.type === 'scenario' ? {index:0} : item.instance.kind === 'social-practice' ? {skip:true as const} : item.instance.answer!;
    assert.ok(!('error' in answerStep(repeat.sessionId,payload,0,i,mem.store)));
  }
  assert.equal(mem.state.programStates[0].completedDays,6);
  const later = makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'repeat',completedDays:10,lastDayIndex:9,startedAt:1}]});
  const start = startSession(profile,false,later.store,{storyChoice:true});
  assert.equal(start.steps,5); assert.ok(later.state.sessions[0].plan.includes('support-practice'));
  console.log('  ok повтор не продвигает календарь; третья неделя содержит практику');
}
