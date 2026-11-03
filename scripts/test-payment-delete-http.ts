/** Isolated SQLite dev server only: simulate a pending payment without calling a provider. */
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const file = process.env.GIB_SQLITE_FILE;
if (!file || !process.env.BASE) throw new Error('Set BASE and GIB_SQLITE_FILE to the isolated test server/database');
const base = process.env.BASE;
const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({ id: Math.floor(Date.now()/10) }) });
const data = [...p.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
const key = crypto.createHmac('sha256', 'WebAppData').update('test-token-only').digest();
p.set('hash', crypto.createHmac('sha256', key).update(data).digest('hex'));
const headers = { 'content-type': 'application/json', 'x-telegram-init-data': p.toString() };
const create = await fetch(`${base}/api/profile`, { method: 'POST', headers, body: JSON.stringify({ name: 'Тест', age: 8 }) });
if (!create.ok) throw new Error('profile create failed');
const id: string = (await create.json()).profile.id;
const db = new DatabaseSync(file);
function change(status: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT data FROM app_state WHERE id=1').get();
    const state = JSON.parse(String(row?.data));
    state.payments = state.payments.filter((p: { profileId: string }) => p.profileId !== id);
    state.payments.push({ id: 'sensitive-test-intent', profileId: id, plan: 'month', amount: '599.00', currency: 'RUB', days: 30, status, createdAt: Date.now(), providerId: 'sensitive-provider-id', confirmationUrl: 'https://example.com/sensitive-link' });
    db.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(state));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
try {
  change('pending');
  const exported = await fetch(`${base}/api/profile/export?profileId=${id}`, { headers });
  const text = await exported.text();
  if (!exported.ok || text.includes('sensitive-provider-id') || text.includes('sensitive-link') || text.includes('sensitive-test-intent') || !text.includes('599.00')) throw new Error('export payment minimization failed');
  console.log('  ok экспорт включает сумму и статус, но не платёжную ссылку и идентификаторы');
  const deletion = await fetch(`${base}/api/profile?profileId=${id}`, { headers, method: 'DELETE' });
  if (deletion.status !== 409 || (await deletion.json()).error !== 'payment_in_progress') throw new Error('pending payment did not block deletion');
  console.log('  ok незавершённый платёж блокирует удаление');
  change('canceled');
  const second = await fetch(`${base}/api/profile?profileId=${id}`, { headers, method: 'DELETE' });
  if (!second.ok) throw new Error('deletion after cancellation failed');
  console.log('  ok после отмены профиль удаляется');
} finally { db.close(); }
