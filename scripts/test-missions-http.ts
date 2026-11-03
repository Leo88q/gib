/** Isolated local SQLite demo only. Reads fixture answers from the database to test rewards. */
import { DatabaseSync } from 'node:sqlite';
const base = process.env.BASE, file = process.env.GIB_SQLITE_FILE;
if (!base || !file) throw new Error('Set BASE and GIB_SQLITE_FILE for an isolated test server');
const headers = { 'content-type': 'application/json', 'x-demo-parent': `mission-test-${Date.now()}` };
async function api(path: string, body?: object, method?: string) {
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json() };
}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); console.log('  ok', message); }
let db: DatabaseSync | undefined;
try {
  const created = await api('/api/profile', { name: 'Тест', age: 8 });
  check(created.status === 200, 'тестовый профиль создан');
  db = new DatabaseSync(file, { readOnly: true });
  const profileId: string = created.data.profile.id;
  const start = await api('/api/session', { action: 'start', profileId });
  let response = start.data;
  for (let step = 0; step < start.data.steps; step++) {
    const row = db.prepare('SELECT data FROM app_state WHERE id=1').get();
    const state = JSON.parse(String(row?.data));
    const session = state.sessions.find((s: { id: string }) => s.id === start.data.sessionId);
    const item = session.runtime.items[step];
    const answer = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
    const result = await api('/api/session', { action: 'answer', sessionId: start.data.sessionId, step, answer, ms: 500 });
    check(result.status === 200, `завершён шаг ${step + 1}`);
    response = result.data;
  }
  check(response.done, 'день завершён');
  const before = await api(`/api/player?profileId=${profileId}`);
  const pending = before.data.missions.filter((m: { done: boolean; claimed: boolean }) => m.done && !m.claimed);
  check(pending.length > 0, 'выполненные миссии доступны после завершения дня');
  const [first, second] = await Promise.all([1, 2].map(() => api('/api/session', { action: 'start', profileId })));
  check(first.status === 200 && second.status === 200 && first.data.sessionId === second.data.sessionId, 'параллельный запуск создаёт одну сессию');
  const claimed = [first.data.autoClaimed, second.data.autoClaimed].filter(x => x?.count > 0);
  check(claimed.length === 1 && claimed[0].count === pending.length, 'незабранные миссии начислены ровно один раз');
  const after = await api(`/api/player?profileId=${profileId}`);
  check(after.data.player.xp === before.data.player.xp + claimed[0].xp && after.data.player.coins === before.data.player.coins + claimed[0].coins, 'опыт и монеты совпадают с автоматическими наградами');
  const removed = await api(`/api/profile?profileId=${profileId}`, undefined, 'DELETE');
  check(removed.status === 200, 'тестовый профиль удалён');
} finally { db?.close(); }
