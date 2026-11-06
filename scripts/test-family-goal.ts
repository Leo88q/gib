import assert from 'node:assert/strict';
import { familyGoal, familyGoalNotice, FAMILY_GOAL_TARGET } from '../lib/engine/family-goal';
import { advanceFamily, emptyFamily, type FamilyCommand } from '../lib/engine/family';
import { publicFamily } from '../lib/engine/family';

const profiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

// 1. Пустая семья: цель не достигнута, текст не давит и не обещает.
{
  const goal = familyGoal(profiles, new Map([['a', 0], ['b', 0], ['c', 0]]));
  assert.equal(goal.confirmed, 0);
  assert.equal(goal.target, FAMILY_GOAL_TARGET);
  assert.equal(goal.members, 0, 'профили без отметок не считаются участниками');
  assert.equal(goal.reached, false);
  assert.ok(!/должн|обязан|ты\b/i.test(familyGoalNotice(goal)), 'в тексте нет давления');
  assert.ok(familyGoalNotice(goal).includes('когда угодно'), 'начать можно в любой момент');
}

// 2. Вклады складываются, но разбивки по профилям в результате нет.
{
  const goal = familyGoal(profiles, new Map([['a', 4], ['b', 3], ['c', 0]]));
  assert.equal(goal.confirmed, 7);
  assert.equal(goal.members, 2);
  assert.equal(goal.reached, false);
  const text = familyGoalNotice(goal);
  assert.ok(text.includes('7 из 12'), 'показан общий прогресс');
  assert.ok(/осталось 5/i.test(text), 'сказано, сколько осталось');
  assert.ok(!JSON.stringify(goal).includes('"a"'), 'идентификаторы профилей наружу не уходят');
}

// 3. Цель достигнута — но продолжать можно, «перевыполнения» нет.
{
  const goal = familyGoal(profiles, new Map([['a', 8], ['b', 6]]));
  assert.equal(goal.confirmed, 14);
  assert.equal(goal.reached, true);
  const text = familyGoalNotice(goal);
  assert.ok(text.includes('выполнена'), 'факт выполнения назван');
  assert.ok(text.includes('Можно продолжать'), 'продолжение остаётся добровольным');
}

// 4. Чужие и мусорные значения не ломают счёт.
{
  const goal = familyGoal(profiles, new Map([['a', Number.NaN], ['b', -5], ['c', Number.POSITIVE_INFINITY], ['zzz', 100]]));
  assert.equal(goal.confirmed, 0, 'отрицательные, бесконечные и чужие значения игнорируются');
  const rounded = familyGoal(profiles, new Map([['a', 2.9]]));
  assert.equal(rounded.confirmed, 2, 'дробное значение не превращается в лишнюю отметку');
}

// 5. Один ребёнок в семье — цель работает так же, без упоминания «всех детей».
{
  const single = familyGoal([{ id: 'a' }], new Map([['a', 5]]));
  assert.equal(single.confirmed, 5);
  assert.equal(single.members, 1);
}

// 6. Подтверждение семейной идеи действительно увеличивает вклад профиля.
{
  const run = (state: ReturnType<typeof emptyFamily>, action: FamilyCommand['action'], op: string, version: number, ideaId?: string) => {
    const result = advanceFamily(state, { action, operationId: op, expectedVersion: version, ...(ideaId ? { ideaId } : {}) } as FamilyCommand, 'i');
    assert.ok(!('error' in result), `${action} проходит`);
    return (result as { state: ReturnType<typeof emptyFamily> }).state;
  };
  let first = run(emptyFamily(), 'choose', 'o1', 0, 'story');
  first = run(first, 'report', 'o2', 1);
  first = run(first, 'confirm', 'o3', 2);
  let second = run(emptyFamily(), 'choose', 'o4', 0, 'colors');
  second = run(second, 'report', 'o5', 1);
  second = run(second, 'confirm', 'o6', 2);
  const goal = familyGoal([{ id: 'a' }, { id: 'b' }], new Map([['a', first.completed], ['b', second.completed]]));
  assert.equal(goal.confirmed, 2, 'подтверждённые идеи двух профилей складываются');
  assert.equal(goal.members, 2);
}

// 7. Отказ и неподтверждённая отметка не попадают в цель.
{
  let state = advanceFamily(emptyFamily(), { action: 'choose', operationId: 'c1', expectedVersion: 0, ideaId: 'story' }, 'i');
  assert.ok(!('error' in state));
  const reported = advanceFamily((state as { state: ReturnType<typeof emptyFamily> }).state, { action: 'report', operationId: 'c2', expectedVersion: 1 }, 'i');
  assert.ok(!('error' in reported));
  const pending = (reported as { state: ReturnType<typeof emptyFamily> }).state;
  assert.equal(pending.completed, 0, 'без подтверждения вклада нет');
  assert.equal(familyGoal([{ id: 'a' }], new Map([['a', pending.completed]])).confirmed, 0);
}

// 8. Публичная модель цели не отдаёт служебных полей семейных квитанций.
{
  const state = (advanceFamily(emptyFamily(), { action: 'choose', operationId: 'p1', expectedVersion: 0, ideaId: 'story' }, 'i') as { state: ReturnType<typeof emptyFamily> }).state;
  const shown = JSON.stringify(publicFamily(state, '8-10'));
  assert.ok(!shown.includes('fingerprint'), 'отпечаток квитанции не отдаётся');
  assert.ok(!shown.includes('receipts'), 'список квитанций не отдаётся');
}

console.log('  ok семейная цель: вклады без рейтинга, порог, добровольное продолжение и отказ не считаются');
