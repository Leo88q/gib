import assert from 'node:assert/strict';
import { SAFETY_STORIES, SAFETY_STORY_BY_ID, safetyStoryCard } from '../lib/content/safety-story.ts';
import { MINI_STORIES } from '../lib/content/mini-stories.ts';
import { SAFETY_CLOSING, chooseSafetyOption, safetyStoriesFor, startSafetyStory } from '../lib/safety-story.ts';

/** Формулировки, которых в разговоре об опасности быть не должно. */
const FORBIDDEN = [
  'сам виноват', 'ты виноват', 'сама виновата', 'ты сама виновата',
  'точно защитят', 'тебя защитят', 'ничего не случится', 'гарант',
  'никому не рассказывай', 'молчи',
];

/** Слова, которые делают разговор пугающим вместо спокойного объяснения. */
const SCARY = ['кошмар', 'ужас', 'смерт', 'похит', 'маньяк', 'труп'];

const labels = (story: (typeof SAFETY_STORIES)[number]) =>
  Object.values(story.nodes).flatMap(node => node.choices.map(choice => choice.label));

const allText = (story: (typeof SAFETY_STORIES)[number]) =>
  [story.title, story.summary, ...Object.values(story.nodes).flatMap(node => [node.text, ...labels(story)])].join(' ').toLowerCase();

/* ---- 1. Каждая история: связность, достижимость, выход ---- */
for (const story of SAFETY_STORIES) {
  const nodes = story.nodes;
  assert.ok(nodes.start, `${story.id}: нет начала`);
  for (const [id, node] of Object.entries(nodes)) {
    assert.ok(node.text.length > 20, `${story.id}/${id}: слишком короткий текст`);
    assert.ok(node.choices.length > 0, `${story.id}/${id}: нет вариантов`);
    for (const choice of node.choices) {
      assert.ok(choice.label.length > 3, `${story.id}/${id}: пустая подпись`);
      assert.ok(nodes[choice.next], `${story.id}/${id}: переход в несуществующую сцену ${choice.next}`);
    }
    // Сцена либо завершает разговор, либо предлагает продолжить.
    assert.equal(node.ending === true, Boolean(node.ending), `${story.id}/${id}: некорректный ending`);
  }
  // Все сцены достижимы из начала.
  const reachable = new Set<string>();
  const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); nodes[id].choices.forEach(c => visit(c.next)); };
  visit('start');
  assert.equal(reachable.size, Object.keys(nodes).length, `${story.id}: есть недостижимая сцена`);

  // Безопасный путь: только safe-варианты до завершения.
  const seen = new Set<string>();
  const safePath = (id: string): boolean => {
    if (nodes[id].ending) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return nodes[id].choices.some(c => c.safe === true && safePath(c.next));
  };
  assert.ok(safePath('start'), `${story.id}: из начала нет безопасного пути к завершению`);

  /* ---- 2. Из любой сцены ребёнок может выйти на безопасный путь ---- */
  for (const id of Object.keys(nodes)) {
    if (nodes[id].ending) continue;
    const guard = new Set<string>();
    const canRecover = (from: string): boolean => {
      if (nodes[from].ending) return true;
      if (guard.has(from)) return false;
      guard.add(from);
      return nodes[from].choices.some(c => c.safe === true || canRecover(c.next));
    };
    assert.ok(canRecover(id), `${story.id}: из сцены ${id} нет выхода на безопасный путь`);
  }

  /* ---- 3. Опасный вариант не завершает разговор «успехом» ---- */
  for (const [id, node] of Object.entries(nodes)) {
    for (const choice of node.choices) {
      if (!choice.unsafe) continue;
      assert.notEqual(nodes[choice.next]?.ending, true, `${story.id}/${id}: опасный выбор ведёт прямо к финалу (${choice.next})`);
    }
  }

  /* ---- 4. Финал ведёт ко взрослому и не обещает невозможного ---- */
  const endings = Object.values(nodes).filter(node => node.ending);
  assert.ok(endings.length > 0, `${story.id}: нет финала`);
  for (const ending of endings) assert.match(ending.text, /взросл/i, `${story.id}: финал не говорит о взрослом`);

  /* ---- 5. Тон: без обвинений, обещаний и пугающих слов ---- */
  const text = allText(story);
  for (const phrase of FORBIDDEN) assert.ok(!text.includes(phrase), `${story.id}: недопустимая формулировка «${phrase}»`);
  for (const word of SCARY) assert.ok(!text.includes(word), `${story.id}: пугающее слово «${word}»`);

  /* ---- 6. Нет метки оценки выбора ---- */
  assert.ok(!JSON.stringify(story).includes('"quality"'), `${story.id}: метка оценки в контенте`);

  console.log(`  ok  ${story.id}: безопасный путь, выход из любой сцены, финал со взрослым`);
}

/* ---- 7. Набор не сужается до одной истории ---- */
assert.ok(SAFETY_STORIES.length >= 4, 'нужно минимум четыре разные ситуации');
assert.equal(new Set(SAFETY_STORIES.map(s => s.id)).size, SAFETY_STORIES.length, 'идентификаторы повторяются');
for (const band of ['5-7', '8-10', '11-13'] as const) {
  const forBand = safetyStoriesFor(band, SAFETY_STORIES);
  assert.ok(forBand.length >= 3, `${band}: слишком мало историй`);
  assert.ok(forBand.every(s => s.bands.includes(band)), `${band}: попала история для другого возраста`);
  assert.equal(forBand[0].id, safetyStoriesFor(band, SAFETY_STORIES)[0].id, 'порядок нестабилен');
  // каждая история остаётся доступна хотя бы одному возрасту
}
for (const story of SAFETY_STORIES) assert.ok(story.bands.length > 0, `${story.id}: нет подходящего возраста`);
assert.deepEqual(safetyStoryCard(SAFETY_STORIES[0]), { id: SAFETY_STORIES[0].id, title: SAFETY_STORIES[0].title, summary: SAFETY_STORIES[0].summary });
assert.equal(SAFETY_STORY_BY_ID[SAFETY_STORIES[0].id], SAFETY_STORIES[0]);

/* ---- 8. Проход по истории: шаги и ошибки ---- */
{
  const story = SAFETY_STORIES[0];
  const first = startSafetyStory(story);
  assert.equal(first.nodeId, 'start');
  assert.equal(first.ending, false);
  assert.ok(first.text.length > 20);
  const safeIndex = story.nodes.start.choices.findIndex(c => c.safe);
  assert.ok(safeIndex >= 0, 'в начале нет безопасного варианта');
  const next = chooseSafetyOption(story, 'start', safeIndex);
  assert.equal(next.ending, true, 'безопасный вариант должен приводить к развязке');
  assert.match(next.text, /взросл/i);
  assert.throws(() => chooseSafetyOption(story, 'start', 99), /safety_choice_missing/);
  assert.throws(() => chooseSafetyOption(story, 'нет-такой-сцены', 0), /safety_node_missing/);
}

/* ---- 9. Закрывающая фраза: без обещаний и без оценки ---- */
assert.match(SAFETY_CLOSING, /взросл/i);
assert.ok(!SAFETY_CLOSING.includes('молодец'), 'не хвалим за «правильный» выбор');
assert.ok(!SAFETY_CLOSING.includes('оценк'), 'без оценок');

/* ---- 10. Обычные истории проходят прежние проверки переходов ---- */
for (const [title, story] of Object.entries(MINI_STORIES)) {
  const nodes = story.nodes;
  assert.ok(nodes.start, `${title}: нет начала`);
  for (const [id, node] of Object.entries(nodes)) {
    assert.ok(node.text && node.choices.length, `${title}: пустая сцена ${id}`);
    for (const choice of node.choices) assert.ok(choice.label && nodes[choice.next], `${title}: нет перехода ${id} → ${choice.next}`);
  }
  const reachable = new Set<string>();
  const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); nodes[id].choices.forEach(c => visit(c.next)); };
  visit('start');
  assert.equal(reachable.size, Object.keys(nodes).length, `${title}: есть недостижимая сцена`);
  console.log(`  ok  ${title}: переходы и путь к завершению`);
}

/* ---- 11. Вопросы для размышления по возрастам ---- */
const { AGE_REFLECTIONS } = await import('../lib/content/age-reflection.ts');
const competencies = ['self_awareness', 'self_regulation', 'empathy', 'relationships', 'decision_making', 'creative_thinking', 'growth_mindset'] as const;
for (const competency of competencies) {
  const prompts = AGE_REFLECTIONS[competency];
  assert.ok(['5-7','8-10','11-13'].every(b => typeof prompts[b as keyof typeof prompts] === 'string' && prompts[b as keyof typeof prompts].length > 10), `${competency}: отсутствует возрастной вопрос`);
  assert.equal(new Set(Object.values(prompts)).size, 3, `${competency}: возрастные вопросы не различаются`);
}
console.log('  ok вопросы для 7 компетенций адаптированы для трёх возрастных линеек');
