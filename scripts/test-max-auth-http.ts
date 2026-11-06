/** Only for a disposable development database with two distinct fictional tokens. */
import crypto from 'node:crypto';
const base = process.env.BASE ?? 'http://localhost:3000';
const telegramToken = 'test-token-only', maxToken = 'max-test-token-only';
function sign(id: number, token: string, age = 0) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), user: JSON.stringify({ id, first_name: 'Test' }), query_id: 'fictional' });
  const text = [...p.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(text).digest('hex'));
  return p.toString();
}
async function req(path: string, headers: Record<string,string> = {}, body?: object, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json() };
}
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); console.log('  ok', label); }
async function main() {
  const id = Math.floor(Date.now() / 10); const max = sign(id, maxToken); const tg = sign(id, telegramToken);
  const m = { 'x-max-init-data': max }, t = { 'x-telegram-init-data': tg };
  check((await req('/api/profile')).status === 401, 'нет подписи — 401');
  check((await req('/api/profile', { 'x-max-init-data': max.replace(String(id), String(id + 1)) })).status === 401, 'подделанные данные MAX отклонены');
  check((await req('/api/profile', { 'x-max-init-data': sign(id, maxToken, 3601) })).status === 401, 'данные MAX старше часа отклонены');
  check((await req('/api/profile', { 'x-max-init-data': max + '&user=123' })).status === 401, 'дубликаты отклонены');
  check((await req('/api/profile', { 'x-max-init-data': tg })).status === 401 && (await req('/api/profile', { 'x-telegram-init-data': max })).status === 401, 'подписи не взаимозаменяемы');
  check((await req('/api/profile', { ...m, ...t })).status === 401, 'два заголовка отклоняются');
  const mp = await req('/api/profile', m, { name: 'MAX', age: 8 });
  const tp = await req('/api/profile', t, { name: 'Telegram', age: 8 });
  check(mp.status === 200 && tp.status === 200 && mp.data.profile.id !== tp.data.profile.id && mp.data.profile.parentId === `max:${id}` && tp.data.profile.parentId === String(id), 'совпадающие числовые ID платформ изолированы');
  const mid = mp.data.profile.id, tid = tp.data.profile.id;
  for (const endpoint of ['report', 'program', 'player', 'session', 'profile/export', 'practice-map', 'family']) {
    check((await req(`/api/${endpoint}?profileId=${mid}`, t)).status === 404 && (await req(`/api/${endpoint}?profileId=${tid}`, m)).status === 404, `${endpoint}: изоляция между платформами`);
  }
  check((await req('/api/session', m, { action: 'start', profileId: tid })).status === 404, 'нельзя начать чужую сессию');
  const started = await req('/api/session', m, { action: 'start', profileId: mid, storyChoice: true });
  check(started.status === 200 && started.data.sessionId, 'MAX открывает свою игровую сессию');
  check(started.data.storyOffer?.length === 3 && (await req('/api/session', m, { action: 'select_story', sessionId: started.data.sessionId, cardId: started.data.storyOffer[0].id })).status === 200, 'MAX выбирает историю в своей сессии');
  check((await req('/api/session', t, { action: 'answer', sessionId: started.data.sessionId, step: 0, answer: { index: 0 } })).status === 404, 'нельзя ответить в чужой сессии');
  let current = started.data; let step = 0;
  while (step < started.data.steps) {
    const item = current.next ?? current.item;
    let answer: object;
    if (item.type === 'scenario') answer = { index: 0 };
    else {
      const x = item.instance;
      if (x.kind === 'social-practice') answer = { cells: [0, 1, 2] };
      else if (x.kind === 'choice' || x.kind === 'cards') answer = { index: 0 };
      else if (x.kind === 'switch-rounds') answer = { cells: x.rules.map(() => 0) };
      else if (x.kind === 'order') answer = { cells: x.steps.map((_: string, i: number) => i) };
      else if (x.kind === 'digits') answer = { digits: '1' };
      else if (x.kind === 'memory' || x.kind === 'symbol-memory' || x.kind === 'finddiff') answer = { cells: [0] };
      else if (x.kind === 'gonogo') answer = { targets: [] };
      else throw Error('unknown task');
    }
    const payload = { action: 'answer', sessionId: started.data.sessionId, step, answer, ms: 0 };
    const first = await req('/api/session', m, payload), replay = await req('/api/session', m, payload);
    check(first.status === 200 && JSON.stringify(first.data) === JSON.stringify(replay.data), 'MAX: шаг и безопасный повтор');
    current = first.data; step++;
    if (current.done) break;
  }
  check(current.done && current.reward.totalXp > 0 && (await req(`/api/report?profileId=${mid}`, m)).data.report.sessions === 1, 'MAX: полный игровой цикл и один отчёт');

  const second = await req('/api/session', m, { action: 'start', profileId: mid, storyChoice: true });
  check(second.status === 200 && second.data.steps === 5 && second.data.storyOffer?.length >= 2 && second.data.storyOffer?.length <= 3, 'MAX: второй день предлагает две истории');
  check((await req('/api/session', m, { action: 'select_story', sessionId: second.data.sessionId, cardId: 'day_2_default' })).status === 200, 'MAX: выбран исходный сюжет второго дня');
  let next = second.data;
  for (let i = 0; i < 3; i++) {
    const item = next.next ?? next.item;
    let payload: object;
    if (item.type === 'scenario') payload = { index: 0 };
    else if (item.instance.kind === 'choice' || item.instance.kind === 'cards') payload = { index: 0 };
    else if (item.instance.kind === 'digits') payload = { digits: '1' };
    else if (item.instance.kind === 'gonogo') payload = { targets: [] };
    else if (item.instance.kind === 'switch-rounds') payload = { cells: item.instance.rules.map(() => 0) };
    else if (item.instance.kind === 'order') payload = { cells: item.instance.steps.map((_: unknown, j: number) => j) };
    else payload = { cells: [0] };
    const result = await req('/api/session', m, { action: 'answer', sessionId: second.data.sessionId, step: i, answer: payload });
    check(result.status === 200, 'MAX: шаг второго дня'); next = result.data;
  }
  check(next.next?.instance?.kind === 'social-practice', 'MAX: тематическая практика второго дня');
  const skip = { action: 'answer', sessionId: second.data.sessionId, step: 3, answer: { skip: true } };
  const skipped = await req('/api/session', m, skip), repeated = await req('/api/session', m, skip);
  check(skipped.status === 200 && skipped.data.evaluation === 'not_scored' && JSON.stringify(skipped.data) === JSON.stringify(repeated.data), 'MAX: необязательный пропуск и безопасный повтор');
  const map = await req(`/api/practice-map?profileId=${mid}`, m);
  check(map.status === 200 && map.data.topics.find((t: any) => t.id === 'self_awareness').practices === 1, 'MAX: карта показывает завершённую практику');
  const report = await req('/api/telegram/report', m, { profileId: mid });
  check(report.status === 200 && report.data.sent === false && report.data.reason === 'no_bot_credentials', 'MAX ID не используется как адрес Telegram-бота');
  check((await req(`/api/profile?profileId=${mid}`, t, undefined, 'DELETE')).status === 404, 'чужой профиль нельзя удалить');
  check((await req(`/api/profile?profileId=${mid}`, m, undefined, 'DELETE')).status === 200 && (await req(`/api/profile?profileId=${tid}`, t, undefined, 'DELETE')).status === 200, 'тестовые профили удалены владельцами');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
