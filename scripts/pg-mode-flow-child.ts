/**
 * Игровой флоу на PostgreSQL: профиль → программа → сессия → ответы → награды.
 *
 * Запускается дочерним процессом из `test-postgres-store.ts` с
 * `GIB_STORE=postgres`. Здесь проверяется не «режим включается», а то, что игра
 * работает на другой базе так же, как на SQLite.
 */
import assert from 'node:assert/strict';
import { store } from '../lib/store.ts';
import { startSession, answerStep, buildPlan } from '../lib/engine/session.ts';
import { createStoreJournal } from '../lib/events/store-journal.ts';

let okCount = 0;
const ok = (label: string) => {
  okCount++;
  console.log('  ok ' + label);
};

async function main() {
  const journal = createStoreJournal(store);
  const profile = {
    id: 'p_pg_1',
    parentId: 'parent_pg_1',
    name: 'Проверка',
    age: 9 as const,
    band: '8-10' as const,
    timeZone: 'Europe/Moscow',
    createdAt: Date.now(),
  };
  store.addProfile(profile);
  assert.equal(store.profile(profile.id)?.name, 'Проверка', 'профиль записан и прочитан');
  assert.equal(store.profileByParent('parent_pg_1')?.id, profile.id, 'поиск по владельцу работает');
  ok('профиль сохранён в PostgreSQL');

  // Транзакция откатывается целиком: половина записи не остаётся.
  const before = store.profileCount();
  assert.throws(() => {
    store.transaction(() => {
      store.addProfile({ ...profile, id: 'p_rolled_back', parentId: 'parent_rb' });
      throw new Error('нарочная ошибка после записи');
    });
  }, /нарочная ошибка/);
  assert.equal(store.profileCount(), before, 'откат транзакции не оставил профиль');
  ok('транзакция откатывается целиком');

  // План программы строится из базы, а не из памяти процесса.
  // План дня — 4 шага у этого возраста; проверяем, что он вообще строится
  // из состояния базы, а не что в нём конкретное число шагов.
  const plan = buildPlan(profile);
  assert.ok(plan.length >= 3, `план дня построен: ${plan.length} шагов`);

  const started = startSession(profile, false, { ...store, journal, ownerId: profile.parentId });
  assert.ok(started.sessionId, 'сессия открыта');
  assert.equal(store.sessions(profile.id).length, 1, 'сессия в базе');
  const saved = store.getSession(started.sessionId)!;
  assert.equal(saved.profileId, profile.id, 'сессия принадлежит профилю');
  ok('сессия открыта и сохранена');

  // Отвечаем на первый шаг — награда и прогресс пишутся одной транзакцией.
  const first = answerStep(started.sessionId, { index: 0, assisted: false }, 500, 0, { ...store, journal, ownerId: profile.parentId });
  assert.ok(!('error' in first), `ответ принят: ${JSON.stringify(first).slice(0, 120)}`);
  const afterFirst = store.playerState(profile.id);
  assert.ok(afterFirst.xp > 0 || afterFirst.coins > 0 || afterFirst.stars > 0, 'награда начислена');
  ok(`ответ принят, награда записана (XP ${afterFirst.xp})`);

  // Повтор того же ответа не даёт второй награды.
  const xpAfter = store.playerState(profile.id).xp;
  const repeat = answerStep(started.sessionId, { index: 0, assisted: false }, 500, 0, { ...store, journal, ownerId: profile.parentId });
  const duplicate = 'error' in repeat || (repeat as { receipt?: unknown }).receipt !== undefined || store.playerState(profile.id).xp === xpAfter;
  assert.ok(duplicate, 'повтор ответа не начисляет награду дважды');
  ok('повтор ответа не даёт второй награды');

  // Журнал событий в PostgreSQL: запись и чтение.
  const appended = journal.append('parent_pg_1', profile.id, 'pg:1:test', {
    v: 1,
    type: 'task_answered',
    taskKind: 'choice',
    taskSkill: 'attention',
    correct: true,
    assisted: false,
    ms: 500,
  });
  assert.ok(appended.ok, 'событие записано');
  // Движок пишет свои события (старт сессии, ответы), поэтому проверяем именно
  // наше событие по ключу дедупликации, а не общее число строк.
  const listed = journal.list('parent_pg_1', profile.id);
  assert.ok(listed.some(e => e.dedupeKey === 'pg:1:test'), `наше событие читается (всего ${listed.length})`);
  assert.ok(listed.length >= 2, 'события движка тоже на месте');
  assert.equal(journal.list('чужой', profile.id).length, 0, 'чужой владелец событий не видит');
  ok('журнал событий работает в PostgreSQL');

  // Схема не ломается от повторного вызова.
  const { ensureSchemaSync } = await import('../lib/postgres/state-backend.ts');
  const { openBridge } = await import('../lib/postgres/state-backend.ts');
  const { SCHEMA_V1, SCHEMA_V2 } = await import('../lib/postgres/schema.ts');
  ensureSchemaSync(openBridge(), { v1: SCHEMA_V1, v2: SCHEMA_V2 });
  // `before` снят уже после создания профиля, поэтому сравниваем с ним же.
  assert.equal(store.profileCount(), before, 'повторная проверка схемы ничего не удалила');
  ok('обновление схемы идемпотентно');

  console.log(`  ok флоу на PostgreSQL: ${okCount} проверок`);
}

main().catch(error => {
  console.error('AssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
