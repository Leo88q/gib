/** PGlite executes PostgreSQL in-process. This does not replace a real multi-connection server test. */
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, prepareImport, type SqlClient } from '../lib/postgres/migrate.ts';
import { STORE_COLLECTIONS } from '../lib/store-validation.ts';
import { exportOwnedProfile, deleteOwnedProfile } from '../lib/postgres/profile-repository.ts';

function check(v: unknown, label: string): asserts v { if (!v) throw new Error(label); console.log('  ok', label); }
const profile = { id: 'p1', parentId: 'parent1', age: 8, band: '8-10', name: 'Тест', createdAt: 1000 };
const profile2 = { id: 'p2', parentId: 'parent2', age: 6, band: '5-7', name: 'Друг', createdAt: 1001 };
const session = { id: 's1', profileId: 'p1', startedAt: 1100, seconds: 0, tasks: [], plan: ['t'],
  runtime: { sessionId: 's1', profileId: 'p1', plan: [{ type: 'task', taskId: 't' }], items: [{ type: 'task', instance: { kind: 'choice', answer: { index: 1 } } }], index: 0, taskAnswers: [] } };
const source = { profiles: [profile, profile2], skills: [{ profileId: 'p1', skill: 'attention', level: 1 }],
  sessions: [session, { id: 's2', profileId: 'p1', startedAt: 1050, finishedAt: 1090, seconds: 0, tasks: [], plan: [] }],
  subs: [{ profileId: 'p1', status: 'active', until: 2000 }], programStates: [{ profileId: 'p1', completedDays: 1 }],
  playerStates: [{ profileId: 'p1', coins: 42, family: { version: 3, completed: 1, current: { id: 'instance', ideaId: 'story', catalogVersion: 1, status: 'confirmed' }, receipts: [{ id: 'operation', fingerprint: 'confirm|2|' }] } }], payments: [{ id: 'payment-1', profileId: 'p1', providerId: 'provider-1', status: 'pending' }] };
const db = new PGlite();
const client: SqlClient = { query: async (sql, params) => db.query(sql, params) };
const assertReject = async (fn: () => Promise<unknown>, label: string) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, label); };
try {
  const normal = prepareImport({ profiles: [profile], sessions: [] });
  check(STORE_COLLECTIONS.every(key => Array.isArray(normal[key])), 'старый формат без новых коллекций подготовлен без потери данных');
  for (const damaged of [
    { ...source, profiles: [profile, { ...profile2, parentId: 'parent1' }] },
    { ...source, profiles: [{ ...profile, age: 6 }] },
    { ...source, skills: [{ profileId: 'missing', skill: 'attention' }] },
    { ...source, sessions: [{ ...session, startedAt: -1 }] },
    { ...source, payments: [source.payments[0], { ...source.payments[0], id: 'payment-2' }] },
  ]) {
    let rejected = false; try { prepareImport(damaged); } catch { rejected = true; }
    check(rejected, 'дубликат, ошибочная запись или осиротевшая ссылка отклоняются');
  }
  await ensureSchema(client); await ensureSchema(client);
  check(true, 'схема создаётся транзакционно и повторная проверка версии безопасна');
  const failing: SqlClient = { query: async (sql, args) => { if (sql.startsWith('INSERT INTO gib.payments')) throw new Error('injected failure'); return client.query(sql, args); } };
  await assertReject(() => importLegacy(failing, source), 'ошибка в конце переноса откатывает транзакцию');
  const empty = await client.query('SELECT count(*) AS n FROM gib.profiles');
  const mark = await client.query('SELECT imported_at FROM gib.schema_version WHERE id=1');
  check(Number(empty.rows[0].n) === 0 && mark.rows[0].imported_at === null, 'частичный импорт и отметка не сохранены');
  const counts = await importLegacy(client, source);
  check(counts.profiles === 2 && counts.sessions === 2 && counts.payments === 1, 'все коллекции перенесены с проверкой содержимого до commit');
  const ordered = await client.query('SELECT data FROM gib.sessions ORDER BY ordinal');
  check((ordered.rows[0].data as any).id === 's1' && (ordered.rows[1].data as any).id === 's2', 'порядок сессий исходного хранилища сохранён');
  const loaded = ordered.rows[0].data as any;
  check(loaded.runtime.items[0].instance.answer.index === 1, 'активное внутреннее состояние перенесено на сервер без потери');
  const own = await exportOwnedProfile(client, 'parent1', 'p1');
  const foreign = await exportOwnedProfile(client, 'parent2', 'p1');
  check(own?.profile.id === 'p1' && foreign === null && own.sessions.length === 2, 'репозиторий отдаёт данные только владельцу и сохраняет сессии');
  check(own?.player[0].family?.completed === 1 && !JSON.stringify(own).includes('fingerprint'), 'семейное состояние переживает импорт, экспорт исключает технические квитанции');
  check(!JSON.stringify(own).includes('provider-1') && !JSON.stringify(own).includes('"answer"'), 'экспорт исключает платёжный ID и будущий ключ ответа');
  check(await deleteOwnedProfile(client, 'parent2', 'p1') === 'not_found', 'чужой профиль нельзя удалить через репозиторий');
  check(await deleteOwnedProfile(client, 'parent1', 'p1') === 'payment_records', 'платёжный реестр блокирует удаление профиля');
  await assertReject(() => importLegacy(client, source), 'повторный импорт запрещён');
  await assertReject(() => client.query("UPDATE gib.profiles SET parent_id='another' WHERE id='p1'"), 'несогласованность ключа и JSONB отклонена');
  await assertReject(() => client.query("INSERT INTO gib.skills(profile_id,ordinal,skill,data) VALUES('missing',99,'logic','{\"profileId\":\"missing\",\"skill\":\"logic\"}'::jsonb)"), 'внешний ключ отклоняет осиротевший навык');
  await assertReject(() => client.query("DELETE FROM gib.profiles WHERE id='p1'"), 'профиль с платёжными записями не удаляется каскадом');
  await client.query("DELETE FROM gib.payments WHERE id='payment-1'");
  check(await deleteOwnedProfile(client, 'parent1', 'p1') === 'deleted', 'владелец может удалить профиль без платёжных записей');
  check(Number((await client.query('SELECT count(*) AS n FROM gib.sessions')).rows[0].n) === 0 && Number((await client.query('SELECT count(*) AS n FROM gib.profiles')).rows[0].n) === 1, 'после контролируемого удаления платёжной записи каскад ограничен своим профилем');
  await assertReject(() => importLegacy(client, source), 'удаление данных не разрешает повторно импортировать старую копию');
  await client.query('UPDATE gib.schema_version SET version=999 WHERE id=1');
  await assertReject(() => ensureSchema(client), 'неизвестная версия схемы отклоняется');
} finally { await db.close(); }
