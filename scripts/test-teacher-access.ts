/**
 * Доступ педагога: посещаемость группы, но не ребёнок.
 *
 * Почему это тест на запреты, а не на возможности. Главный риск новой роли — не
 * «педагог не увидел нужное», а «педагог увидел лишнее». Лишнее здесь — то, что
 * ребёнок говорил взрослому в кабинете: ответы в историях, сохранённые чувства,
 * выбранные варианты. Достаточно один раз отдать это в список группы, и
 * обещание «приложение не следит за ребёнком» перестаёт быть правдой.
 *
 * Проверяется:
 *  1. Доступ есть только через группу, которую ведёт этот педагог.
 *  2. Знание идентификатора профиля доступа не даёт.
 *  3. Чужая группа не видна, даже если группа существует.
 *  4. В списке детей ровно поля TeacherStudentView и ничего сверх.
 *  5. Отметки считаются по данным, а не выдумываются.
 *  6. Педагог без групп не видит никого.
 *
 * Запуск: npm run test:teacher-access
 */

import { strict as assert } from 'node:assert';
import {
  TEACHER_CANNOT_SEE,
  groupStudents,
  teacherCanMark,
  teacherCanSee,
  type Group,
  type Membership,
  type Store,
} from '../lib/teacher/access.ts';
import type { Profile } from '../lib/types.ts';

const profile = (id: string, parentId: string): Profile => ({
  id,
  parentId,
  name: `Ребёнок ${id}`,
  age: 9,
  band: '8-10',
  createdAt: 1,
});

const makeStore = (): Store => {
  const groups: Group[] = [
    { id: 'g1', teacherId: 'demo:teacher-anna', name: '4Б', year: 2026 },
    { id: 'g2', teacherId: 'demo:teacher-boris', name: '4В', year: 2026 },
  ];
  const memberships: Membership[] = [
    { groupId: 'g1', profileId: 'p1', joinedAt: 1 },
    { groupId: 'g1', profileId: 'p2', joinedAt: 2 },
    { groupId: 'g2', profileId: 'p3', joinedAt: 3 },
  ];
  return {
    groups,
    memberships,
    profiles: [profile('p1', 'demo:parent-1'), profile('p2', 'demo:parent-2'), profile('p3', 'demo:parent-3')],
  };
};

const store = makeStore();
const ANNA = 'demo:teacher-anna';
const BORIS = 'demo:teacher-boris';

/* ---- 1. Доступ через группу ---- */

assert.equal(teacherCanSee(store, ANNA, 'p1'), true, 'педагог не видит ребёнка из своей группы');
assert.equal(teacherCanSee(store, ANNA, 'p2'), true, 'педагог не видит второго ребёнка из своей группы');
console.log('  ok педагог видит детей своей группы');

/* ---- 2. Чужая группа ---- */

assert.equal(teacherCanSee(store, ANNA, 'p3'), false, 'педагог видит ребёнка из чужой группы');
assert.equal(teacherCanSee(store, BORIS, 'p1'), false, 'другой педагог видит чужого ребёнка');
console.log('  ok чужая группа закрыта');

/* ---- 3. Знание идентификатора не даёт доступа ---- */

assert.equal(teacherCanSee(store, ANNA, 'p999'), false, 'несуществующий профиль дал доступ');
assert.equal(teacherCanSee(store, 'demo:teacher-nobody', 'p1'), false, 'педагог без групп видит ребёнка');
console.log('  ok идентификатор профиля сам по себе доступа не даёт');

/* ---- 4. Список детей: ровно поля TeacherStudentView ---- */

const marks = (profileId: string) =>
  profileId === 'p1'
    ? { attended: 8, missed: 1, showcases: 3 }
    : { attended: 5, missed: 4, showcases: 1 };

const students = groupStudents(store, ANNA, 'g1', marks);
assert.equal(students.length, 2, `в группе ${students.length} детей, ожидалось 2`);

const allowedFields = ['profileId', 'name', 'age', 'attended', 'missed', 'showcases'];
for (const student of students) {
  assert.deepEqual(
    Object.keys(student).sort(),
    [...allowedFields].sort(),
    `в карточке ребёнка лишние поля: ${Object.keys(student).join(', ')}`,
  );
}

const first = students.find((student) => student.profileId === 'p1');
assert.ok(first, 'ребёнок p1 пропал из списка');
assert.equal(first.attended, 8, 'посещения не переданы');
assert.equal(first.missed, 1, 'пропуски не переданы');
assert.equal(first.showcases, 3, 'показы не переданы');
console.log('  ok в карточке только имя, возраст и три счётчика');

/* ---- 5. Чужая группа в списке не появляется ---- */

assert.deepEqual(groupStudents(store, ANNA, 'g2', marks), [], 'педагог получил детей чужой группы');
assert.deepEqual(groupStudents(store, BORIS, 'g1', marks), [], 'другой педагог получил чужую группу');
assert.deepEqual(groupStudents(store, ANNA, 'нет-такой', marks), [], 'несуществующая группа дала детей');
console.log('  ok чужие и несуществующие группы пусты');

/* ---- 6. Отметки: права те же, что на просмотр ---- */

assert.equal(teacherCanMark(store, ANNA, 'p1'), true, 'педагог не может отметить своего ребёнка');
assert.equal(teacherCanMark(store, ANNA, 'p3'), false, 'педагог может отметить чужого ребёнка');
assert.equal(teacherCanMark(store, 'demo:teacher-nobody', 'p1'), false, 'посторонний может отметить');
console.log('  ok отметить занятие можно только своему ребёнку');

/* ---- 7. Запреты объявлены явно ---- */

assert.ok(TEACHER_CANNOT_SEE.length >= 4, 'список запретов пуст: обещание не зафиксировано');
for (const forbidden of ['сохранённые чувства', 'отчёт родителю']) {
  assert.ok(
    (TEACHER_CANNOT_SEE as readonly string[]).includes(forbidden),
    `в списке запретов нет «${forbidden}»: обещание потерялось`,
  );
}
console.log('  ok запреты объявлены списком, а не только комментарием');

console.log('\nДоступ педагога: посещаемость группы, без содержимого ребёнка.');
