/** Isolated development SQLite only; deliberately inserts sentinel data. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE ?? 'http://localhost:3033';
const file = process.env.GIB_SQLITE_FILE ?? 'data/export-minimization-http.sqlite';
const suffix = Date.now().toString(36);
const owner = { 'content-type': 'application/json', 'x-demo-parent': `export-owner-${suffix}` };
const other = { 'content-type': 'application/json', 'x-demo-parent': `export-other-${suffix}` };
async function post(path: string, body: object, headers = owner) { const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { response, data: await response.json() }; }
function check(v: unknown, label: string): asserts v { if (!v) throw Error(label); console.log('  ok', label); }
const created = await post('/api/profile', { name: 'Тест', age: 8 });
const profileId = created.data.profile.id;
const sibling = await post('/api/profile', { name: 'PRIVATE_OTHER_NAME', age: 9 }, other);
const start = await post('/api/session', { action: 'start', profileId });
check(created.response.ok && sibling.response.ok && start.response.ok, 'созданы два профиля и активная сессия');
const db = new DatabaseSync(file);
db.exec('BEGIN IMMEDIATE');
try {
  const data = JSON.parse(String(db.prepare('SELECT data FROM app_state WHERE id=1').get()?.data));
  data.profiles.find((p: any) => p.id === profileId).internalField = 'PRIVATE_SENTINEL';
  const session = data.sessions.find((s: any) => s.id === start.data.sessionId);
  session.internalField = 'PRIVATE_SENTINEL'; session.runtime.internalField = 'PRIVATE_SENTINEL';
  const player = data.playerStates.find((p: any) => p.profileId === profileId);
  player.internalField = 'PRIVATE_SENTINEL'; player.equipped.internalField = 'PRIVATE_SENTINEL'; player.missions.internalField = 'PRIVATE_SENTINEL'; player.stats.internalField = 'PRIVATE_SENTINEL';
  data.payments.push({ id: 'PRIVATE_SENTINEL', providerId: 'PRIVATE_SENTINEL', confirmationUrl: 'PRIVATE_SENTINEL', profileId, plan: 'month', amount: '599.00', currency: 'RUB', days: 30, status: 'canceled', createdAt: Date.now(), internalField: 'PRIVATE_SENTINEL' });
  db.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(data)); db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
const exportResponse = await fetch(`${base}/api/profile/export?profileId=${encodeURIComponent(profileId)}`, { headers: owner });
const text = await exportResponse.text();
check(exportResponse.ok && !text.includes('PRIVATE_SENTINEL') && !text.includes('PRIVATE_OTHER_NAME') && !text.includes('internalField'), 'внутренние поля, платёжные идентификаторы и чужой профиль не попадают в экспорт');
const exported = JSON.parse(text);
check(exported.profile.id === profileId && exported.sessions[0].inProgress.step === 0 && exported.payments[0].amount === '599.00', 'выгрузка содержит ожидаемые данные владельца');
check(exportResponse.headers.get('cache-control')?.includes('no-store') && exportResponse.headers.get('content-disposition')?.includes('attachment'), 'выгрузка не кэшируется и выдаётся как файл');
const denied = await fetch(`${base}/api/profile/export?profileId=${encodeURIComponent(profileId)}`, { headers: other });
check(denied.status === 404, 'другой профиль не может получить экспорт');
for (const [id, headers] of [[profileId, owner], [sibling.data.profile.id, other]] as const) {
  const removed = await fetch(`${base}/api/profile?profileId=${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  check(removed.ok, 'тестовый профиль удалён');
}
