/**
 * HTTP: выключатель повторов и выбор темы.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-review-off-http.ts
 */
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://localhost:3000';

async function api(path: string, parent: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-demo-parent': parent, ...(init?.headers as Record<string, string> | undefined) },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function main() {
  const parent = `rev-${Date.now()}`;
  const created = await api('/api/profile', parent, { method: 'POST', body: JSON.stringify({ name: 'Мира', age: 9 }) });
  const id = created.data.profile.id;

  // 1. По умолчанию повторы включены.
  const program = await api(`/api/program?profileId=${id}`, parent);
  assert.equal(program.status, 200);
  assert.equal(program.data.reviewOff, false, 'по умолчанию повторение включено');
  console.log('  ok по умолчанию предложения повтора включены');

  // 2. Взрослый выключает — флаг виден и в программе, и в сессии.
  const off = await api('/api/program', parent, { method: 'POST', body: JSON.stringify({ profileId: id, reviewOff: true }) });
  assert.equal(off.status, 200);
  assert.equal(off.data.reviewOff, true);
  assert.ok(String(off.data.notice).includes('Новые дни и прогресс это не меняет'), 'сказано, что прогресс не меняется');
  assert.equal((await api(`/api/program?profileId=${id}`, parent)).data.reviewOff, true);
  const session = await api(`/api/session?profileId=${id}`, parent);
  assert.equal(session.data.program.reviewOff, true, 'сессия тоже знает о выключателе');
  assert.equal(session.data.program.review, null, 'тема не предлагается');
  assert.deepEqual(session.data.program.reviewOptions, [], 'списка тем нет');
  console.log('  ok выключение убирает предложения и не трогает прогресс');

  // 3. Некорректные данные отклоняются.
  for (const bad of [{ reviewOff: 'yes' }, { reviewOff: 1 }, {}]) {
    const r = await api('/api/program', parent, { method: 'POST', body: JSON.stringify({ profileId: id, ...bad }) });
    assert.equal(r.status, 400, `отклонено: ${JSON.stringify(bad)}`);
  }
  const extra = await api('/api/program', parent, { method: 'POST', body: JSON.stringify({ profileId: id, reviewOff: true, reset: true }) });
  assert.equal(extra.status, 400, 'лишние поля отклоняются');
  console.log('  ok некорректные запросы отклоняются');

  // 4. Обратное включение возвращает предложения (темы ещё не назрели — список пустой, но флаг снят).
  const on = await api('/api/program', parent, { method: 'POST', body: JSON.stringify({ profileId: id, reviewOff: false }) });
  assert.equal(on.data.reviewOff, false);
  assert.equal((await api(`/api/program?profileId=${id}`, parent)).data.reviewOff, false);
  console.log('  ok включение возвращает прежнее поведение');

  // 5. Чужой владелец не меняет настройку.
  const foreign = await api('/api/program', 'stranger', { method: 'POST', body: JSON.stringify({ profileId: id, reviewOff: true }) });
  assert.equal(foreign.status, 404);
  assert.equal((await api(`/api/program?profileId=${id}`, parent)).data.reviewOff, false, 'настройка не изменилась');
  console.log('  ok чужая семья не меняет выключатель');

  // 6. Выбор темы принимается только как строка-идентификатор.
  const badTopic = await api('/api/session', parent, { method: 'POST', body: JSON.stringify({ action: 'start', profileId: id, review: true, reviewTopicId: '../etc/passwd' }) });
  assert.equal(badTopic.status, 400, 'подозрительный идентификатор отклонён');
  console.log('  ok идентификатор темы валидируется');

  console.log('  ok повторение по HTTP: выключатель, валидация, изоляция');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
