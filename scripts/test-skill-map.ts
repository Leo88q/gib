/**
 * Карта умений глазами ребёнка: что показываем и чего не показываем.
 *
 * Проверки не про вёрстку. Они про то, что ребёнок не получит инструмент
 * самооценки, которого у него не просили:
 *  - навык отмечается фактом встречи, без уровней и процентов;
 *  - непройденное видно как «пока не встречалось», а не как минус;
 *  - повтор истории не делает навык «более освоенным»;
 *  - названия берутся под возраст, а не одни на всех;
 *  - в ответе API нет ключей, из которых можно собрать рейтинг.
 */
import assert from 'node:assert/strict';
import { skillMap, skillMood, CHILD_COMPETENCY_LABELS } from '../lib/engine/skill-map.ts';
import type { AgeBand, Session } from '../lib/types.ts';

const NOW = 1_700_000_000_000;

const session = (id: string, scenarioId: string, finishedAt: number | null = NOW): Session => ({
  id,
  profileId: 'p',
  startedAt: NOW - 300_000,
  ...(finishedAt === null ? {} : { finishedAt }),
  seconds: 240,
  ...(scenarioId ? { scenario: { scenarioId } } : {}),
} as unknown as Session);

const bands: AgeBand[] = ['5-7', '8-10', '11-13'];

/* ---- 1. Пустая карта: всего 48, но встречено ноль ---- */
{
  for (const band of bands) {
    const map = skillMap('p', [], band);
    assert.equal(map.length, 7, 'семь тем');
    assert.equal(map.reduce((sum, group) => sum + group.total, 0), 48, 'всего 48 умений');
    assert.equal(map.reduce((sum, group) => sum + group.met, 0), 0, 'на старте ничего не встречено');
    // Умения есть в карте до того, как они встретились: иначе карта — список достижений.
    assert.ok(map.every(group => group.skills.length > 0), 'у каждой темы есть умения');
    assert.ok(map.every(group => group.skills.every(skill => skill.met === false)), 'ни одно не отмечено');
  }
  console.log('  ok пустая карта: 48 умений на месте, ни одно не отмечено');
}

/* ---- 2. Факт встречи, а не уровень ---- */
{
  const map = skillMap('p', [session('s1', 'sk_name_feelings')], '8-10');
  const met = map.flatMap(group => group.skills).filter(skill => skill.met);
  assert.deepEqual(met.map(skill => skill.id), ['name_feelings'], 'отмечено ровно то, что было в истории');
  for (const skill of map.flatMap(group => group.skills)) {
    for (const forbidden of ['level', 'percent', 'score', 'grade', 'mastery', 'rank']) {
      assert.equal(Object.hasOwn(skill, forbidden), false, `у умения не должно быть поля ${forbidden}`);
    }
  }
  console.log('  ok умение отмечается фактом встречи, полей уровня и процентов нет');
}

/* ---- 3. Повтор истории не накручивает прогресс ---- */
{
  const once = skillMap('p', [session('s1', 'sk_hold_impulse')], '8-10');
  const twice = skillMap('p', [session('s1', 'sk_hold_impulse'), session('s2', 'sk_hold_impulse')], '8-10');
  const pick = (map: typeof once) => map.flatMap(group => group.skills).find(skill => skill.id === 'hold_impulse')!;
  assert.equal(pick(once).stories, 1, 'одна история');
  assert.equal(pick(twice).stories, 1, 'та же история второй раз — всё ещё одна');
  assert.equal(pick(once).met, pick(twice).met, 'статус не меняется от повтора');

  // Разные истории одного навыка считаются: это не накрутка, а разные сцены.
  const two = skillMap('p', [session('s1', 'w6d3'), session('s2', 'w6d5_design')], '8-10');
  assert.equal(two.flatMap(group => group.skills).find(skill => skill.id === 'try_another_way')!.stories, 2);
  console.log('  ok повтор истории не считается дважды, разные истории считаются');
}

/* ---- 4. Незавершённая сессия не засчитывается ---- */
{
  const map = skillMap('p', [session('s1', 'sk_not_judge', null)], '8-10');
  assert.equal(map.reduce((sum, group) => sum + group.met, 0), 0, 'незаконченная история не даёт умение');
  const other = skillMap('other', [session('s1', 'sk_not_judge')], '8-10');
  assert.equal(other.reduce((sum, group) => sum + group.met, 0), 0, 'чужая сессия не засчитывается');
  console.log('  ok незавершённая и чужая сессия умений не дают');
}

/* ---- 5. Формулировки под возраст ---- */
{
  const labels = bands.map(band => {
    const map = skillMap('p', [], band);
    return map.flatMap(group => group.skills).map(skill => skill.label);
  });
  // Все 48 названий есть в каждой возрастной линейке и все непустые.
  for (const [index, list] of labels.entries()) {
    assert.equal(list.length, 48, `линейка ${bands[index]}: 48 названий`);
    assert.ok(list.every(label => typeof label === 'string' && label.trim().length > 3), 'названия заполнены');
  }
  // Хотя бы половина названий различается между младшей и старшей линейкой.
  const differs = labels[0].filter((label, i) => label !== labels[2][i]).length;
  assert.ok(differs >= 24, `названия почти не меняются по возрасту: различий ${differs} из 48`);

  // Названия тем — живые слова, а не названия компетенций из методички.
  for (const label of Object.values(CHILD_COMPETENCY_LABELS)) {
    for (const adult of ['компетенц', 'самопознан', 'саморегуляц', 'эмпати', 'мышление роста', 'принятие решений']) {
      assert.equal(label.toLowerCase().includes(adult), false, `тема для ребёнка названа взрослым словом: ${label}`);
    }
  }
  console.log('  ok названия умений и тем — под возраст, без взрослых терминов');
}

/* ---- 6. Фраза о состоянии не оценивает ---- */
{
  const empty = skillMood(skillMap('p', [], '8-10'));
  assert.equal(empty.mood, 'start');
  assert.ok(!/молодец|плохо|ошиб|провал|отста/i.test(empty.text), 'на старте нет оценки');

  const some = skillMood(skillMap('p', [session('s1', 'sk_name_feelings')], '8-10'));
  assert.equal(some.mood, 'moving');
  assert.ok(!/молодец|плохо|ошиб|провал|отста/i.test(some.text), 'в движении нет оценки');
  // Пропуск не подаётся как минус: ребёнок не должен читать это как «я отстаю».
  assert.ok(!/пропущен|недостаточн|слаб/i.test(some.text), 'нет слов о недостаточности');

  // Состояние «много» проверяем на заведомо полном наборе.
  const full = skillMap('p', [], '8-10').map(group => ({ ...group, met: group.total }));
  const many = skillMood(full);
  assert.equal(many.mood, 'many');
  assert.ok(!/молодец|лучший|уровень|рейтинг/i.test(many.text), 'и на максимуме нет похвалы-рейтинга');
  console.log('  ok фраза о состоянии без оценок и без «ты отстаёшь»');
}

/* ---- 7. В ответе нет ничего для рейтинга ---- */
{
  const map = skillMap('p', [session('s1', 'sk_combine_ideas')], '11-13');
  const text = JSON.stringify(map).toLowerCase();
  for (const forbidden of ['"score"', '"level"', '"percent"', '"rank"', '"grade"', '"quality"', '"correct"']) {
    assert.equal(text.includes(forbidden), false, `в карте не должно быть ${forbidden}`);
  }
  // Названия навыков для взрослого наружу не уходят: ребёнку они не нужны.
  assert.equal(text.includes('"title"'), true, 'title остаётся служебным полем для проверок');
  console.log('  ok в карте нет полей оценки, рейтинга и правильности');
}

console.log('\nКарта умений ребёнка: 48 навыков, 7 тем, встречи вместо оценок.');
