/** Запустить на dev-сервере с TELEGRAM_BOT_TOKEN=test-token-only и BASE=http://localhost:3002. Только тестовые данные. */
import crypto from 'node:crypto';

const base = process.env.BASE ?? 'http://localhost:3002';
const token = 'test-token-only';
function signed(id: number, age = 0) {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), user: JSON.stringify({ id, first_name: 'Test' }) });
  const check = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  data.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return data.toString();
}
async function request(path: string, identity: string | null, body?: object, method?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (identity) headers['x-telegram-init-data'] = identity;
  const response = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
function check(condition: unknown, label: string): asserts condition { if (!condition) throw Error(label); console.log('  ok ', label); }
async function main() {
  const id = Math.floor(Date.now() / 10);
  const a = signed(id), b = signed(id + 1);
  check((await request('/api/profile', null)).status === 401, 'нет данных: 401');
  check((await request('/api/profile', signed(id, 90000))).status === 401, 'просроченная подпись: 401');
  check((await request('/api/profile', a.replace('auth_date=', 'auth_date=1'))).status === 401, 'подделанная подпись: 401');
  const raw = (body: string, contentType = 'application/json') => fetch(base + '/api/profile', { method: 'POST', headers: { 'content-type': contentType, 'x-telegram-init-data': a }, body });
  check((await raw('null')).status === 400, 'null вместо объекта: 400');
  check((await raw('{broken')).status === 400, 'повреждённый JSON: 400');
  check((await raw(JSON.stringify({ name: 'x'.repeat(17000) }))).status === 413, 'крупное тело: 413');
  check((await raw('{}', 'text/plain')).status === 415, 'неверный тип контента: 415');
  const profileGet = await fetch(base + '/api/profile', { headers: { 'x-telegram-init-data': a } });
  check(profileGet.headers.get('cache-control')?.includes('no-store'), 'API не кэширует данные');
  const create = await request('/api/profile', a, { name: 'Тест', age: 9 });
  check(create.status === 200 && create.data.profile, 'подписанный родитель создаёт профиль');
  const profileId = create.data.profile.id;
  check(create.data.profile.timeZone === 'Europe/Moscow', 'часовой пояс по умолчанию — Москва');
  check((await request('/api/profile', a, { profileId, timeZone: 'Invalid/Zone' }, 'PATCH')).status === 400, 'неизвестный часовой пояс отклонён');
  check((await request('/api/profile', b, { profileId, timeZone: 'Asia/Vladivostok' }, 'PATCH')).status === 404, 'нельзя изменить пояс чужого профиля');
  const updated = await request('/api/profile', a, { profileId, timeZone: 'Asia/Vladivostok' }, 'PATCH');
  check(updated.status === 200 && updated.data.profile.timeZone === 'Asia/Vladivostok', 'родитель может изменить свой часовой пояс');
  const emptyReport = await request(`/api/report?profileId=${profileId}`, a);
  check(emptyReport.data.report.skills.every((s: { delta: unknown }) => s.delta === null), 'при отсутствии данных сравнение не выдаётся за ноль');
  const ownProgram = await request(`/api/program?profileId=${profileId}`, a);
  check(ownProgram.status === 200 && ownProgram.data.weeks.length === 12, 'программа содержит 12 недель');
  check(ownProgram.data.weeks.every((w: { week: number; art: string }) => w.art === `/art/week-${String(w.week).padStart(2, '0')}.png`), 'каждая неделя использует отдельную сцену');
  const ownSessionPlan = await request(`/api/session?profileId=${profileId}`, a);
  check(ownSessionPlan.status === 200 && ownSessionPlan.data.program.weekArt === ownProgram.data.weeks[0].art, 'текущая сцена передаётся в детский экран');
  const artResults = await Promise.all(ownProgram.data.weeks.map((w: { art: string }) => fetch(base + w.art)));
  check(artResults.every(r => r.ok && r.headers.get('content-type')?.includes('image/png')), 'все 12 иллюстраций недель доступны по HTTP');

  const other = await request('/api/profile', b, { name: 'Другой ребёнок', age: 6 });
  check(other.status === 200 && other.data.profile.id !== profileId, 'второй родитель создаёт отдельный профиль');
  for (const endpoint of ['report', 'program', 'player', 'session', 'subscribe', 'profile/export']) {
    check((await request(`/api/${endpoint}?profileId=${profileId}`, b)).status === 404, `чужой ${endpoint}: 404`);
  }
  check((await request('/api/player', b, { profileId, action: 'claim', id: 'helper' })).status === 404, 'чужой player POST: 404');
  check((await request('/api/subscribe', b, { profileId })).status === 404, 'чужая подписка POST: 404');
  check((await request('/api/telegram/report', b, { profileId, chatId: id + 1 })).status === 404, 'чужая отправка отчёта: 404');
  check((await request('/api/session', b, { action: 'start', profileId })).status === 404, 'чужой старт сессии: 404');
  check((await request('/api/player', a, { profileId, action: 'invalid', id: 'hat' })).status === 400, 'неизвестное действие игрока отклонено');
  check((await request('/api/player', a, { profileId, action: 'buy', id: { invalid: true } })).status === 400, 'неверный id предмета отклонён');
  check((await request('/api/session', a, { action: 'start', profileId, repeat: 'false' })).status === 400, 'неверный тип repeat отклонён');
  const start = await request('/api/session', a, { action: 'start', profileId });
  check(start.status === 200 && start.data.sessionId, 'владелец начинает сессию');
  check((await request('/api/session', b, { action: 'answer', sessionId: start.data.sessionId, step: 0, answer: { index: 0 } })).status === 404, 'чужой ответ: 404');
  const inst = start.data.item.instance;
  const validAnswer = start.data.item.type === 'scenario' || inst.kind === 'choice' || inst.kind === 'cards' ? { index: 0 } : inst.kind === 'gonogo' ? { targets: [] } : inst.kind === 'digits' ? { digits: '1' } : { cells: [0] };
  check((await request('/api/session', a, { action: 'answer', sessionId: start.data.sessionId, step: 0, answer: validAnswer, ms: -1 })).status === 400, 'отрицательное время отклонено без изменения шага');
  const simultaneous = await Promise.all([1, 2].map(() => request('/api/session', a, { action: 'answer', sessionId: start.data.sessionId, step: 0, answer: validAnswer })));
  check(simultaneous.every(r => r.status === 200) && JSON.stringify(simultaneous[0].data) === JSON.stringify(simultaneous[1].data), 'одновременный повтор возвращает один результат без двойного начисления');
  check((await request('/api/session', a, { action: 'answer', sessionId: start.data.sessionId, step: 0, answer: { ...validAnswer, index: 999 } })).status === 409, 'изменённый ответ на пройденный шаг отклонён');
  const exported = await request(`/api/profile/export?profileId=${profileId}`, a);
  check(exported.status === 200 && exported.data.formatVersion === 1 && exported.data.profile.id === profileId, 'владелец получает экспорт');
  check(exported.data.sessions.some((s: { id: string }) => s.id === start.data.sessionId), 'экспорт содержит сессии владельца');
  check(exported.data.sessions.every((s: { runtime?: unknown; lastReceipt?: unknown }) => !s.runtime && !s.lastReceipt), 'экспорт не раскрывает будущие задания и ключи ответа');
  check(!JSON.stringify(exported.data).includes(other.data.profile.id) && !JSON.stringify(exported.data).includes('Другой ребёнок'), 'экспорт не содержит данные другого профиля');
  check((await request(`/api/profile?profileId=${profileId}`, b, undefined, 'DELETE')).status === 404, 'чужой профиль нельзя удалить');
  check((await request(`/api/profile?profileId=${profileId}`, a, undefined, 'DELETE')).status === 200, 'владелец удаляет профиль');
  check((await request(`/api/report?profileId=${profileId}`, a)).status === 404, 'удалённые данные недоступны');
  check((await request(`/api/profile/export?profileId=${profileId}`, a)).status === 404, 'экспорт удалённого профиля недоступен');
  check((await request(`/api/profile?profileId=${other.data.profile.id}`, b, undefined, 'DELETE')).status === 200, 'второй тестовый профиль удалён');
  check((await request('/api/session', a, { action: 'answer', sessionId: start.data.sessionId, step: 1, answer: { index: 0 } })).status === 404, 'удалена игровая сессия');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
