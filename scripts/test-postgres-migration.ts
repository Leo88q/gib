/** PGlite executes PostgreSQL in-process. This does not replace a real multi-connection server test. */
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, prepareImport, type SqlClient } from '../lib/postgres/migrate.ts';
import { SCHEMA_V1, SCHEMA_V2 } from '../lib/postgres/schema.ts';
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
  /*
   * Миграция 2 → 3: живая база на запуске будет именно версии 2, поэтому
   * ступень проверяется на отдельной базе, собранной как старая — только из
   * схем v1 и v2. Без этого «миграция» проверялась бы на базе, которая уже
   * создана с новой схемой.
   */
  const old = new PGlite();
  const oldClient: SqlClient = { query: async (sql, params) => old.query(sql, params) };
  const statements = (sql: string) => sql.split(';').map(part => part.trim()).filter(Boolean);
  await oldClient.query('CREATE SCHEMA IF NOT EXISTS gib');
  await oldClient.query('CREATE TABLE gib.schema_version (id SMALLINT PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, imported_at TIMESTAMPTZ)');
  for (const statement of [...statements(SCHEMA_V1), ...statements(SCHEMA_V2)]) await oldClient.query(statement);
  await oldClient.query('INSERT INTO gib.schema_version (id, version) VALUES (1, 2)');
  await oldClient.query(
    "INSERT INTO gib.profiles(id,ordinal,parent_id,age,band,created_at,data) VALUES('old-1',0,'old-parent',9,'8-10',1000,'{\"id\":\"old-1\",\"parentId\":\"old-parent\",\"age\":9,\"band\":\"8-10\",\"createdAt\":1000}'::jsonb)");
  const oldReject = async (fn: () => Promise<unknown>, label: string) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, label); };
  await oldReject(() => oldClient.query(
    "INSERT INTO gib.payments(id,ordinal,profile_id,status,data) VALUES('r0',0,'old-1','refunded','{\"id\":\"r0\",\"profileId\":\"old-1\",\"status\":\"refunded\"}'::jsonb)"),
    'до миграции статус возврата запрещён — это и есть причина миграции');
  await oldClient.query(
    "INSERT INTO gib.payments(id,ordinal,profile_id,status,data) VALUES('pend',0,'old-1','pending','{\"id\":\"pend\",\"profileId\":\"old-1\",\"status\":\"pending\",\"receiptEmail\":\"old@example.ru\"}'::jsonb)");
  await ensureSchema(oldClient);
  check(Number((await oldClient.query('SELECT version FROM gib.schema_version WHERE id=1')).rows[0].version) === 3, 'миграция 2 → 3 поднимает версию');
  check((await oldClient.query("SELECT receipt_email FROM gib.payments WHERE id='pend'")).rows[0].receipt_email === 'old@example.ru', 'миграция переносит почту чека из JSON в столбец');
  await oldClient.query(
    "INSERT INTO gib.payments(id,ordinal,profile_id,status,provider_refund_id,data) VALUES('r1',1,'old-1','refunded','refund-1','{\"id\":\"r1\",\"profileId\":\"old-1\",\"status\":\"refunded\",\"providerRefundId\":\"refund-1\"}'::jsonb)");
  check(Number((await oldClient.query("SELECT count(*) AS n FROM gib.payments WHERE status='refunded'")).rows[0].n) === 1, 'после миграции подтверждённый возврат записывается');
  await oldReject(() => oldClient.query(
    "INSERT INTO gib.payments(id,ordinal,profile_id,status,provider_refund_id,data) VALUES('r2',2,'old-1','refunded','refund-1','{\"id\":\"r2\",\"profileId\":\"old-1\",\"status\":\"refunded\"}'::jsonb)"),
    'второй возврат с тем же идентификатором провайдера невозможен');
  await oldClient.query(
    "INSERT INTO gib.payments(id,ordinal,profile_id,status,data) VALUES('r3',3,'old-1','refund_pending','{\"id\":\"r3\",\"profileId\":\"old-1\",\"status\":\"refund_pending\"}'::jsonb)");
  check(Number((await oldClient.query("SELECT count(*) AS n FROM gib.payments WHERE status='refund_pending'")).rows[0].n) === 1, 'возврат в процессе тоже известен схеме');
  await oldReject(() => oldClient.query("UPDATE gib.payments SET status='failure' WHERE id='r1'"), 'выдуманный статус платежа отклоняется');
  await oldClient.query("UPDATE gib.profiles SET meeting_lead='child', household_adult='none' WHERE id='old-1'");
  check((await oldClient.query("SELECT meeting_lead FROM gib.profiles WHERE id='old-1'")).rows[0].meeting_lead === 'child', 'режим встречи хранится в профиле');
  await oldReject(() => oldClient.query("UPDATE gib.profiles SET meeting_lead='teacher' WHERE id='old-1'"), 'неизвестный режим встречи отклоняется');
  await oldReject(() => oldClient.query("UPDATE gib.profiles SET household_adult='neighbour' WHERE id='old-1'"), 'ответ про взрослого ограничен тремя вариантами');
  await ensureSchema(oldClient);
  check(Number((await oldClient.query('SELECT version FROM gib.schema_version WHERE id=1')).rows[0].version) === 3, 'повторный запуск миграции не меняет версию');
  await old.close();

  await client.query('UPDATE gib.schema_version SET version=999 WHERE id=1');
  await assertReject(() => ensureSchema(client), 'неизвестная версия схемы отклоняется');
} finally { await db.close(); }
