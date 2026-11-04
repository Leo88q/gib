/**
 * HTTP: сводка данных профиля — только категории и количество.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-data-controls-http.ts
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
  const parent = `data-${Date.now()}`;
  const created = await api('/api/profile', parent, { method: 'POST', body: JSON.stringify({ name: 'Мира', age: 9 }) });
  assert.equal(created.status, 200);
  const id = created.data.profile.id;

  // 1. Сводка отдаёт категории и количество.
  const summary = await api(`/api/profile/data?profileId=${id}`, parent);
  assert.equal(summary.status, 200);
  assert.equal(summary.data.profile.name, 'Мира');
  assert.deepEqual(Object.keys(summary.data.counts).sort(), ['events', 'familyMarks', 'feelings', 'sessions', 'stories', 'tasks']);
  assert.equal(summary.data.counts.feelings, 0);
  assert.equal(summary.data.feelings.enabled, false, 'по умолчанию сохранение чувств выключено');
  assert.equal(summary.data.feelings.retentionDays, 90);
  assert.equal(summary.data.feelings.limit, 60);
  console.log('  ok сводка: категории, количество, согласие выключено по умолчанию');

  // 2. В ответе нет содержимого чувств, ответов и событий.
  const raw = JSON.stringify(summary.data);
  assert.ok(!raw.includes('joy') && !raw.includes('радость'), 'нет содержимого чувств');
  assert.ok(!raw.includes('scenarioId'), 'нет сценарных ответов');
  assert.ok(!raw.includes('initData'), 'нет платформенных данных');
  assert.ok(!raw.includes('answer'), 'нет текстов ответов');
  console.log('  ok содержимого ответов и чувств в сводке нет');

  // 3. Включённое согласие и сохранённая отметка видны только как счётчик.
  const consent = await api('/api/feelings', parent, { method: 'POST', body: JSON.stringify({ profileId: id, action: 'consent', enabled: true }) });
  assert.equal(consent.status, 200);
  const save = await api('/api/feelings', parent, { method: 'POST', body: JSON.stringify({ profileId: id, action: 'checkin', feelings: ['joy'] }) });
  assert.equal(save.status, 200);
  const after = await api(`/api/profile/data?profileId=${id}`, parent);
  assert.equal(after.data.counts.feelings, 1, 'отметка посчитана');
  assert.equal(after.data.feelings.enabled, true);
  assert.ok(!JSON.stringify(after.data).includes('joy'), 'сама отметка не раскрыта');
  console.log('  ok сохранённая отметка видна как число, без содержимого');

  // 4. Чужой владелец не получает сводку.
  assert.equal((await api(`/api/profile/data?profileId=${id}`, 'stranger')).status, 404);
  assert.equal((await api('/api/profile/data', parent)).status, 400, 'profileId обязателен');
  console.log('  ok сводка изолирована по владельцу');

  // 5. После отзыва согласия и удаления профиля данных не остаётся.
  const revoke = await api('/api/feelings', parent, { method: 'POST', body: JSON.stringify({ profileId: id, action: 'consent', enabled: false }) });
  assert.equal(revoke.status, 200);
  const revoked = await api(`/api/profile/data?profileId=${id}`, parent);
  assert.equal(revoked.data.counts.feelings, 0, 'отзыв стирает отметки');
  assert.equal(revoked.data.feelings.enabled, false);
  assert.equal((await api(`/api/profile?profileId=${id}`, parent, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/profile/data?profileId=${id}`, parent)).status, 404, 'после удаления сводки нет');
  console.log('  ok отзыв стирает отметки, удаление закрывает сводку');

  console.log('  ok данные профиля по HTTP: категории, согласие, изоляция, отзыв, удаление');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
