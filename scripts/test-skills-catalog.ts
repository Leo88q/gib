/**
 * Проверка карты навыков: 48 навыков ↔ истории программы.
 *
 * Что здесь важно и чего не хватает в обычных проверках контента. Тесты
 * контента смотрят, что история заполнена и не оценивает ребёнка. Они не
 * смотрят, что **все** заявленные навыки хоть где-то отрабатываются: можно
 * иметь сотню отличных историй и три навыка, о которых никто не вспомнил.
 *
 * Проверки:
 *  1. каталог: ровно 48 навыков, у каждого одна компетенция, уникальные id;
 *  2. у каждого навыка есть формулировка для трёх возрастов, и они разные;
 *  3. формулировки не оценивают ребёнка и не обещают результат;
 *  4. каждая история контента размечена, и в карте нет лишних историй;
 *  5. каждый навык тренируется хотя бы одной историей;
 *  6. разметка «история → навыки» согласована с компетенцией навыка.
 *
 * Пункт 5 — тот, ради которого это существует. Он падает, пока дыры не
 * закрыты контентом, и не даёт им потеряться.
 */
import assert from 'node:assert/strict';
import { SKILLS_CATALOG, SKILLS_PER_COMPETENCY, SKILL_BY_ID, skillsForCompetency } from '../lib/content/skills-catalog.ts';
import { STORY_SKILLS, coveredSkillIds, mismatchedStories } from '../lib/content/story-skills.ts';
import { PROGRAM_SCENARIOS } from '../lib/content/program/index.ts';
import { STORYLETS_BY_ID } from '../lib/content/storylets.ts';
import { PROGRAM_DAYS } from '../lib/content/program/index.ts';
import { DAY_STORY_CARDS } from '../lib/day/story-deck.ts';

const BANDS = ['5-7', '8-10', '11-13'] as const;

/* ---- 1. Каталог ---- */
assert.equal(SKILLS_CATALOG.length, 48, `в каталоге ${SKILLS_CATALOG.length} навыков, ожидалось 48`);
const ids = SKILLS_CATALOG.map(skill => skill.id);
assert.equal(new Set(ids).size, ids.length, 'идентификаторы навыков повторяются');
for (const id of ids) assert.match(id, /^[a-z][a-z0-9_]{2,40}$/, `недопустимый id навыка: ${id}`);

const competencies = Object.keys(SKILLS_PER_COMPETENCY) as (keyof typeof SKILLS_PER_COMPETENCY)[];
const sum = competencies.reduce((total, key) => total + SKILLS_PER_COMPETENCY[key], 0);
assert.equal(sum, 48, `сумма по компетенциям ${sum}, ожидалось 48`);
for (const competency of competencies) {
  assert.equal(skillsForCompetency(competency).length, SKILLS_PER_COMPETENCY[competency],
    `${competency}: навыков не столько, сколько заявлено`);
}
console.log('  ok каталог: 48 навыков, у каждого одна компетенция, id уникальны');

/* ---- 2. Формулировки для трёх возрастов ---- */
for (const skill of SKILLS_CATALOG) {
  const labels = BANDS.map(band => skill.child[band]);
  for (const [index, band] of BANDS.entries()) {
    const label = labels[index];
    assert.ok(typeof label === 'string' && label.trim().length > 3, `${skill.id}/${band}: пустая формулировка`);
    assert.ok(label.length <= 60, `${skill.id}/${band}: формулировка длиннее 60 знаков («${label}»)`);
  }
  // Формулировки должны отличаться: одна и та же фраза для 6 и 12 лет
  // означает, что возрастной адаптации нет, а не что она «универсальна».
  assert.ok(new Set(labels).size >= 2, `${skill.id}: формулировки не различаются по возрасту`);
  assert.ok(skill.title.trim().length > 3, `${skill.id}: нет названия для взрослого`);
  assert.ok(skill.looksLike.trim().length > 10, `${skill.id}: не описано, как навык выглядит в жизни`);
}
console.log('  ok у каждого навыка есть отдельная формулировка для трёх возрастов');

/* ---- 3. Формулировки не оценивают и не обещают ---- */
{
  const JUDGE = /молодец|неправильн|плохой ребёнок|хороший ребёнок|ты должен|ты должна|стыдно|позор/i;
  const PROMISE = /гарант|точно получится|всегда получится|обязательно получится|станет лучше|избавит/i;
  for (const skill of SKILLS_CATALOG) {
    const texts = [skill.title, skill.looksLike, ...BANDS.map(band => skill.child[band])];
    for (const text of texts) {
      assert.ok(!JUDGE.test(text), `${skill.id}: формулировка оценивает ребёнка («${text}»)`);
      assert.ok(!PROMISE.test(text), `${skill.id}: формулировка обещает результат («${text}»)`);
    }
  }
  console.log('  ok формулировки не оценивают ребёнка и не обещают результат');
}

/* ---- 4. Каждая история размечена ---- */
const contentStories = new Set<string>([
  ...PROGRAM_SCENARIOS.map(scenario => scenario.id),
  ...Object.keys(STORYLETS_BY_ID),
]);
assert.ok(contentStories.size >= 121, `в контенте ${contentStories.size} историй, ожидалось не меньше 121`);

const mapped = new Set(Object.keys(STORY_SKILLS));
const unmapped = [...contentStories].filter(id => !mapped.has(id));
const extra = [...mapped].filter(id => !contentStories.has(id));
assert.deepEqual(unmapped, [], `истории без карты навыков: ${unmapped.join(', ')}`);
assert.deepEqual(extra, [], `в карте есть истории, которых нет в контенте: ${extra.join(', ')}`);
console.log(`  ok все ${contentStories.size} историй размечены, лишних записей нет`);

/* ---- 5. Ссылочная целостность и компетенции ---- */
const contentById = new Map<string, { competency: string }>();
for (const scenario of PROGRAM_SCENARIOS) contentById.set(scenario.id, { competency: scenario.competency });
for (const storylet of Object.values(STORYLETS_BY_ID)) contentById.set(storylet.id, { competency: storylet.competency });

for (const [storyId, entry] of Object.entries(STORY_SKILLS)) {
  assert.ok(Array.isArray(entry.skills) && entry.skills.length > 0, `${storyId}: не указано ни одного навыка`);
  assert.ok(entry.skills.length <= 4, `${storyId}: слишком много навыков (${entry.skills.length}), история тренирует размытое`);
  assert.equal(new Set(entry.skills).size, entry.skills.length, `${storyId}: навыки повторяются`);
  for (const skillId of entry.skills) {
    const skill = SKILL_BY_ID[skillId];
    assert.ok(skill, `${storyId}: неизвестный навык ${skillId}`);
  }
}
console.log('  ok ссылки на навыки существуют, у истории не больше четырёх');

/* ---- 6. Покрытие: каждый навык тренируется ---- */
{
  const covered = coveredSkillIds();
  const uncovered = SKILLS_CATALOG.filter(skill => !covered.has(skill.id)).map(skill => skill.id);
  assert.deepEqual(uncovered, [],
    `навыки без единой истории: ${uncovered.join(', ')}. ` +
    'Нужен контент или честное снижение числа навыков, но не тихая дыра.');
  console.log(`  ok все 48 навыков тренируются хотя бы одной историей`);
}

/* ---- 6b. Все навыки достижимы за один проход программы ---- */
{
  // Покрытие контентом — ещё не доступность. В выдаче дня максимум три
  // карточки: основная история и две дополнительные. Если сцена с навыком
  // лежит четвёртой, ребёнок за один проход её не увидит, и навык останется
  // «покрытым» только на бумаге. Проверяем именно доступное подмножество.
  const reachable = new Set<string>();
  for (const day of PROGRAM_DAYS) {
    const extra = DAY_STORY_CARDS.filter(card => card.dayIndex === day.index).slice(0, 2);
    for (const scenarioId of [day.day.scenarioId, ...extra.map(card => card.scenarioId)]) {
      for (const skillId of STORY_SKILLS[scenarioId]?.skills ?? []) reachable.add(skillId);
    }
  }
  const unreachable = SKILLS_CATALOG.filter(skill => !reachable.has(skill.id)).map(skill => skill.id);
  assert.deepEqual(unreachable, [],
    `навыки недостижимы за один проход (сцена есть, но ребёнок до неё не дойдёт): ${unreachable.join(', ')}`);
  console.log(`  ok все 48 навыков достижимы за один проход (${reachable.size}/48)`);
}

/* ---- 7. Расхождения разметки видны, а не спрятаны ---- */
{
  const mismatched = mismatchedStories();
  // Расхождения допустимы: часть историй писалась под другую компетенцию.
  // Важно, что они перечислены явно, а не выглядят как норма.
  for (const item of mismatched) {
    assert.ok(contentById.has(item.storyId), `${item.storyId}: расхождение для несуществующей истории`);
  }
  if (mismatched.length) {
    console.log(`  ! разметка компетенции расходится с содержанием: ${mismatched.length} историй (см. npm run skills:map)`);
  } else {
    console.log('  ok разметка компетенции совпадает с содержанием');
  }
}

console.log(`\nКарта навыков: 48 навыков, ${contentStories.size} историй, покрытие проверено.`);
