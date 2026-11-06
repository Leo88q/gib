import assert from 'node:assert/strict';
import { makeSessionMemory } from '../lib/postgres/session-memory.ts';
import { startSession, selectSessionStory, answerStep } from '../lib/engine/session.ts';
import { readDeepInk } from '../lib/engine/deep-ink.ts';
import { deepInkFor } from '../lib/engine/deep-ink-catalog.ts';
import { ALL_DEEP_FOLLOWUPS } from '../lib/content/program/all-deep-followups.ts';
import { PROGRAM_SCENARIOS } from '../lib/content/program/index.ts';
import { STORYLETS_BY_ID } from '../lib/content/storylets.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import { DAY_STORY_CARDS } from '../lib/day/story-deck.ts';
import { validateStore } from '../lib/store-validation.ts';
import type { AgeBand, Profile } from '../lib/types.ts';

const bands: [AgeBand, number][] = [['5-7', 6], ['8-10', 9], ['11-13', 12]];
const allIds = [...PROGRAM_SCENARIOS.map(s => s.id), ...Object.keys(STORYLETS_BY_ID)];

/* ---- 1. Продолжения есть у каждой истории и для каждого возраста ---- */
assert.equal(allIds.length, 121, 'ожидалась 121 история');
for (const id of allIds) {
  const paths = ALL_DEEP_FOLLOWUPS[id];
  assert.ok(paths, `${id}: нет продолжений`);
  for (const [band] of bands) {
    const three = paths[band];
    assert.equal(three.length, 3, `${id}/${band}: нужно ровно три варианта`);
    for (const followUp of three) {
      assert.ok(followUp.prompt.length > 15, `${id}/${band}: пустой вопрос второго шага`);
      assert.equal(followUp.choices.length, 2, `${id}/${band}: нужно два варианта`);
      assert.equal(followUp.endings.length, 2, `${id}/${band}: нужно две развязки`);
      // Обе ветки — законные последствия: ни одна не наказывает и не хвалит.
      for (const ending of followUp.endings) {
        assert.ok(ending.length > 20, `${id}/${band}: короткая развязка`);
        // Оценка человека, а не упоминание ошибки: «у ошибки есть место» — нормально,
        // «ты неправильно сделал» — нет.
        assert.ok(!/молодец|неправильн|ты ошиб|это плохо|это хорошо|ты должен|ты должна/i.test(ending), `${id}/${band}: развязка оценивает: «${ending}»`);
        assert.ok(!/(^|[.!?]\s*)Правильно\b/i.test(ending), `${id}/${band}: развязка хвалит за «правильный» выбор`);
        assert.ok(!/виноват|сам виноват/i.test(ending), `${id}/${band}: развязка обвиняет`);
      }
      // Без оценок личности, обещаний и гарантий.
      const text = [followUp.prompt, ...followUp.choices, ...followUp.endings].join(' ');
      for (const forbidden of ['ты должен', 'ты должна', 'гарант', 'точно получится', 'всегда получится']) {
        assert.ok(!text.toLowerCase().includes(forbidden), `${id}/${band}: обещание или требование «${forbidden}»`);
      }
    }
  }
}
/* ---- 1b. Возрастная длина: младшим — короче и без взрослых абстракций ---- */
{
  // Порог не про «простоту вообще», а про то, что читает шестилетка сам.
  const MAX_LEN: Record<AgeBand, number> = { '5-7': 70, '8-10': 110, '11-13': 130 };
  const ADULT_WORDS = /вывод|эпизод|пределы|ресурс|оправдан|версия|контекст/i;
  for (const [band] of bands) {
    for (const id of allIds) {
      for (const followUp of ALL_DEEP_FOLLOWUPS[id][band]) {
        for (const phrase of [followUp.prompt, ...followUp.endings]) {
          assert.ok(phrase.length <= MAX_LEN[band], `${id}/${band}: слишком длинная фраза (${phrase.length}): «${phrase}»`);
        }
      }
    }
  }
  for (const id of allIds) {
    for (const followUp of ALL_DEEP_FOLLOWUPS[id]['5-7']) {
      for (const phrase of [followUp.prompt, ...followUp.endings]) {
        assert.ok(!ADULT_WORDS.test(phrase), `${id}/5-7: взрослое слово в «${phrase}»`);
      }
    }
  }
  console.log('  ok длина фраз по возрастам: 5-7 до 70 знаков без взрослых абстракций');
}
console.log('  ok 121 история × 3 возраста: второй шаг, две ветки, ни одной оценки выбора');

/* ---- 1в. Первый шаг истории: возраст, длина, отсутствие пугающего и обещаний ---- */
{
  // Порог — про то, что читает ребёнок сам. Второй шаг короче, потому что сцена
  // уже задана; первый её задаёт, поэтому ему дан запас на одну фразу.
  const MAX_LEN: Record<AgeBand, number> = { '5-7': 85, '8-10': 120, '11-13': 140 };
  const SCARY = ['кошмар', 'ужас', 'смерт', 'похит', 'маньяк', 'труп', 'катастроф'];
  const PROMISE = ['гарант', 'точно получится', 'всегда получится', 'обязательно получится', 'все получится'];
  const BLAME = ['ты виноват', 'сам виноват', 'сама виновата', 'тебя накажут', 'неудачник'];
  const ADULT_WORDS = /вывод|эпизод|пределы|ресурс|оправдан|версия|контекст|рефлекси|стратеги/i;
  let phrases = 0;
  for (const id of allIds) {
    const scenario = [...PROGRAM_SCENARIOS, ...Object.values(STORYLETS_BY_ID)].find(s => s.id === id)!;
    for (const [band] of bands) {
      const variant = scenario.variants[band];
      assert.ok(variant, `${id}/${band}: нет возрастного варианта`);
      const texts = [variant.title, variant.text, ...variant.options.flatMap(o => [o.text, o.note])];
      assert.ok(variant.text.length <= MAX_LEN[band], `${id}/${band}: первый шаг длинноват (${variant.text.length}): «${variant.text}»`);
      for (const phrase of texts) {
        phrases++;
        const low = phrase.toLowerCase();
        for (const word of SCARY) assert.ok(!low.includes(word), `${id}/${band}: пугающее слово «${word}»`);
        for (const word of PROMISE) assert.ok(!low.includes(word), `${id}/${band}: обещание «${word}»`);
        for (const word of BLAME) assert.ok(!low.includes(word), `${id}/${band}: обвинение «${word}»`);
        // Младшему не подсовываем взрослую лексику — то же правило, что для второго шага.
        if (band === '5-7') assert.ok(!ADULT_WORDS.test(phrase), `${id}/5-7: взрослое слово в «${phrase}»`);
      }
    }
  }
  console.log(`  ok ${allIds.length} историй × 3 возраста: первый шаг читаем по возрасту, без пугающего и обещаний (${phrases} фраз)`);
}



/* ---- 2. Второй шаг читается деревом и не отличается от снимка ---- */
{
  const checked = new Set<string>();
  for (const [band, age] of bands) {
    for (let day = 0; day < 60; day += 3) {
      const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age, band, createdAt: 1 };
      const mem = makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{ profileId: 'p', completedDays: day, lastDayIndex: day, startedAt: 1 }] });
      const start = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
      const runtime = mem.state.sessions[0].runtime!;
      assert.ok(runtime.storyOffer?.length, `день ${day}: нет предложения историй`);
      for (const card of runtime.storyOffer ?? []) {
        const variant = runtime.storyVersions![card.id].variants[band];
        assert.ok(variant.deepInk, `${card.scenarioId}/${band}: нет второго шага в снимке`);
        const first = readDeepInk(variant.deepInk!);
        assert.equal(first.text, variant.text);
        assert.equal(first.choices.length, 3);
        const followUps = ALL_DEEP_FOLLOWUPS[card.scenarioId][band];
        for (let index = 0; index < 3; index++) {
          const second = readDeepInk(variant.deepInk!, [index]);
          // Ветка ведёт к своей истории: её вопрос и варианты могли быть
          // переставлены при перемешивании, поэтому ищем по всему набору.
          // У первых дней есть авторское дерево, оно имеет приоритет над общим
          // набором продолжений: там тексты свои, их проверяет test-deep-story.
          const handwritten = deepInkFor(card.scenarioId, band) !== undefined;
          const match = handwritten
            ? { prompt: second.text.slice(second.text.indexOf(variant.options[index].note) + variant.options[index].note.length + 1), choices: second.choices as [string, string], endings: ['', ''] as [string, string] }
            : followUps.find(fu => second.text === `${variant.options[index].note} ${fu.prompt}`);
          assert.ok(match, `${card.scenarioId}/${band}: ветка ${index} не совпала ни с одним продолжением («${second.text}»)`);
          if (!handwritten) {
            assert.deepEqual(second.choices, [...match!.choices]);
            const third = readDeepInk(variant.deepInk!, [index, 0]);
            assert.equal(third.text, match!.endings[0]);
            assert.equal(third.choices.length, 0);
          } else {
            // Авторское дерево тоже обязано доводить до развязки без лишних шагов.
            const third = readDeepInk(variant.deepInk!, [index, 0]);
            assert.equal(third.choices.length, 0, `${card.scenarioId}: ветка не заканчивается`);
            assert.ok(third.text.length > 20, `${card.scenarioId}: пустая развязка`);
          }
          checked.add(`${card.scenarioId}:${band}`);
        }
      }
    }
  }
  assert.ok(checked.size >= 100, `проверено мало историй: ${checked.size}`);
  console.log(`  ok ${checked.size} пар «история+возраст»: текст, вопрос и два варианта совпадают с контентом`);
}

/* ---- 3. Полный проход через движок: награда одинаковая на любой ветке ---- */
{
  const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age: 9, band: '8-10', createdAt: 1 };
  // Карточка предлагается только в свой день: ищем день по сценарию.
  const dayOf = (scenarioId: string): number => {
    const day = PROGRAM_DAYS.findIndex(d => d.day.scenarioId === scenarioId);
    if (day >= 0) return day;
    const card = DAY_STORY_CARDS.find(c => c.scenarioId === scenarioId);
    assert.ok(card, `${scenarioId}: карточки нет в каталоге предложений`);
    return card!.dayIndex;
  };
  let runs = 0;
  for (const scenarioId of ['w12d5', 'w6d3_pause', 'w9d2_weather', 'w1d2']) {
    const targetDay = dayOf(scenarioId);
    for (let original = 0; original < 3; original++) {
      for (let branch = 0; branch < 2; branch++) {
        const mem = makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{ profileId: 'p', completedDays: targetDay, lastDayIndex: Math.max(0, targetDay - 1), startedAt: 1 }] });
        const start = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
        const card = mem.state.sessions[0].runtime!.storyOffer!.find(c => c.scenarioId === scenarioId);
        assert.ok(card, `${scenarioId}: карточки нет в предложении дня`);
        assert.deepEqual(selectSessionStory(start.sessionId, card!.id, mem.store), { ok: true, cardId: card!.id });
        const item = mem.state.sessions[0].runtime!.items[0];
        if (item.type !== 'scenario') throw new Error('первый шаг — не история');
        const order = item.order[original];
        const deep = readDeepInk(item.content!.variants['8-10'].deepInk!, [order, branch]);
        const result = answerStep(start.sessionId, { index: original, cells: [branch] }, 0, 0, mem.store);
        assert.ok(!('error' in result), `${scenarioId}: ответ отклонён`);
        assert.equal(result.feedback, deep.text, `${scenarioId}: развязка не совпала`);
        assert.equal(result.evaluation, 'not_scored', 'второй шаг не оценивается');
        // Награда одна и та же, какой бы путь ни выбрал ребёнок.
        assert.equal(result.reward.xp, 25);
        assert.equal(result.reward.coins, 8);
        // Повтор не платит второй раз, другой вариант — конфликт.
        assert.deepEqual(answerStep(start.sessionId, { index: original, cells: [branch] }, 0, 0, mem.store), result);
        assert.deepEqual(answerStep(start.sessionId, { index: original, cells: [1 - branch] }, 0, 0, mem.store), { error: 'step_conflict' });
        validateStore({ profiles: [profile], sessions: mem.state.sessions });
        runs++;
      }
    }
  }
  assert.equal(runs, 24);
  console.log('  ok 24 полных прохода: развязка, равная награда, повтор без второй оплаты');
}

/* ---- 4. Старые снимки не ломаются ---- */
{
  const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age: 9, band: '8-10', createdAt: 1 };
  const mem = makeSessionMemory({ profile, skills: [], sessions: [], playerStates: [], programStates: [{ profileId: 'p', completedDays: 0, lastDayIndex: 0, startedAt: 1 }] });
  const start = startSession(profile, false, mem.store, { storyChoice: true, journey: true });
  const card = mem.state.sessions[0].runtime!.storyOffer!.find(c => c.scenarioId === 'w1d1')!;
  selectSessionStory(start.sessionId, card.id, mem.store);
  const item = mem.state.sessions[0].runtime!.items[0];
  if (item.type !== 'scenario') throw new Error('нет истории');
  // Снимок без второго шага: как сессия, начатая до обновления.
  delete item.content!.variants['8-10'].deepInk;
  const old = answerStep(start.sessionId, { index: 0 }, 0, 0, mem.store);
  assert.ok(!('error' in old), 'старый снимок принимает одиночный выбор');
  assert.equal(old.evaluation, 'not_scored');
  // Снимок с готовым деревом первого дня остаётся на своём дереве.
  assert.ok(deepInkFor('w1d1', '8-10'), 'для первого дня используется готовое дерево');
  console.log('  ok старые снимки без второго шага по-прежнему проходятся одним выбором');
}
