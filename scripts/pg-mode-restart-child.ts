/**
 * Перезапуск на PostgreSQL: новый процесс видит данные предыдущего.
 *
 * Если бы `store` в режиме PostgreSQL держал данные только в памяти, тест флоу
 * прошёл бы, а боевой сервис терял бы всё после перезапуска. Здесь это
 * проверяется отдельным процессом поверх уже существующей базы.
 */
import assert from 'node:assert/strict';
import { store } from '../lib/store.ts';
import { startSession, answerStep } from '../lib/engine/session.ts';
import { createStoreJournal } from '../lib/events/store-journal.ts';

let okCount = 0;
const ok = (label: string) => {
  okCount++;
  console.log('  ok ' + label);
};

async function main() {
  // Данные созданы предыдущим процессом в том же каталоге.
  const profile = store.profile('p_pg_1');
  assert.ok(profile, 'профиль из прошлого процесса найден');
  assert.equal(profile.name, 'Проверка', 'имя профиля то же');
  ok('профиль пережил перезапуск');

  const skills = store.skills(profile.id);
  assert.ok(skills.length >= 6, `навыки на месте: ${skills.length}`);
  ok('навыки пережили перезапуск');

  const journal = createStoreJournal(store);
  const listed = journal.list('parent_pg_1', profile.id);
  assert.ok(listed.some(e => e.dedupeKey === 'pg:1:test'), 'событие из прошлого процесса на месте');
  ok('журнал событий пережил перезапуск');

  const sessions = store.sessions(profile.id);
  assert.ok(sessions.length >= 1, 'сессии из прошлого процесса на месте');
  const existing = sessions[0];
  ok('сессии пережили перезапуск');

  // Данные, записанные **сейчас**, видны сразу — без «отложенного сброса».
  //
  // Новая сессия у нового ребёнка того же взрослого: ответ на первый шаг
  // проверяется движком по виду задания, поэтому берём свежую сессию, а не
  // продолжаем чужую с середины (там другой вид задания и другой ответ).
  const fresh = { ...profile, id: 'p_pg_2', name: 'Второй', createdAt: Date.now() };
  if (!store.profile(fresh.id)) store.addProfile(fresh);
  const started = startSession(fresh, false, { ...store, journal, ownerId: fresh.parentId });
  assert.ok(started.sessionId, 'новая сессия открывается поверх данных прошлого процесса');

  const xpBefore = store.playerState(fresh.id).xp;
  const stepped = answerStep(started.sessionId, { index: 0, assisted: false }, 500, started.step, { ...store, journal, ownerId: fresh.parentId });
  assert.ok(!('error' in stepped), `ответ принят в новой сессии: ${JSON.stringify(stepped).slice(0, 120)}`);
  const after = store.playerState(fresh.id);
  assert.ok(after.xp > xpBefore, `XP вырос: ${xpBefore} → ${after.xp}`);
  ok(`запись из второго процесса видна сразу (XP ${xpBefore} → ${after.xp})`);

  // Старые сессии не перетёрты.
  assert.ok(store.getSession(existing.id), 'сессия из прошлого процесса не удалена');
  ok('старые сессии не затронуты');

  console.log(`  ok перезапуск на PostgreSQL: ${okCount} проверок`);
}

main().catch(error => {
  console.error('AssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
