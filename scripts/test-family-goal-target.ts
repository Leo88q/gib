import assert from 'node:assert/strict';
import { familyGoal, familyGoalNotice, validGoalTarget, FAMILY_GOAL_MAX, FAMILY_GOAL_MIN, FAMILY_GOAL_TARGET } from '../lib/engine/family-goal';

const kids = [{ id: 'a' }, { id: 'b' }];
const confirmed = new Map([['a', 5], ['b', 4]]);

// 1. По умолчанию цель 12, сумма без разбивки.
const def = familyGoal(kids, confirmed);
assert.equal(def.target, FAMILY_GOAL_TARGET);
assert.equal(def.confirmed, 9);
assert.equal(def.members, 2);
assert.equal(def.reached, false);

// 2. Размер цели можно уменьшить — тогда цель считается достигнутой.
assert.equal(familyGoal(kids, confirmed, 8).reached, true);
assert.equal(validGoalTarget(9), false, '9 — не шаг цели');
assert.equal(familyGoal(kids, confirmed, 12).confirmed, 9);
assert.equal(familyGoal(kids, new Map([['a', 8], ['b', 4]]), 12).reached, true, 'ровно цель — достигнута');
assert.equal(familyGoal(kids, confirmed, 20).reached, false);

// 3. Мусорный размер не ломает расчёт: берётся значение по умолчанию.
for (const bad of [0, -4, 13, 1000, 5, 7.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const goal = familyGoal(kids, confirmed, bad as number);
  assert.equal(goal.target, FAMILY_GOAL_TARGET, `мусор ${String(bad)} → цель по умолчанию`);
}

// 4. Допустимые размеры — только шаг 4 в пределах.
for (const good of [4, 8, 12, 60]) assert.equal(validGoalTarget(good), true, `${good} допустим`);
for (const bad of [3, 5, 62, 0, -8, 6.5, '12', null, undefined]) assert.equal(validGoalTarget(bad), false, `${String(bad)} недопустим`);
assert.equal(FAMILY_GOAL_MIN, 4);
assert.equal(FAMILY_GOAL_MAX, 60);

// 5. Отметки сверх цели не пропадают и не превращаются в «перевыполнение».
const over = familyGoal(kids, new Map([['a', 40], ['b', 30]]), 12);
assert.equal(over.confirmed, 70, 'сумма честная');
assert.match(familyGoalNotice(over), /Можно продолжать, если хочется/);

// 6. Текст не рейтингует детей и не обещает награду.
const text = familyGoalNotice(def);
assert.ok(!/лучше|молодец|рейтинг|балл/i.test(text), 'нет оценки и баллов');
assert.ok(!/\d+\s*(балл|монет)/i.test(text), 'нет валюты');

// 7. Пустая семья и мусорные отметки.
assert.equal(familyGoal([], new Map()).confirmed, 0);
assert.equal(familyGoal(kids, new Map([['a', -3], ['b', Number.NaN]])).confirmed, 0, 'отрицательные и NaN не считаются');

// 8. Профили вне карты не добавляют вклад.
assert.equal(familyGoal([{ id: 'a' }, { id: 'zzz' }], confirmed).confirmed, 5);

// 9. Разбивки по детям в результате нет: ни id, ни полей на ребёнка.
const keys = Object.keys(def).sort();
assert.deepEqual(keys, ['confirmed', 'members', 'reached', 'target'], 'в ответе нет профилей');

console.log('  ok общая цель семьи: сумма без разбивки, размер цели, мусор, отсутствие рейтинга');
