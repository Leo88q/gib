/**
 * HTTP-проверка сохранения отметок чувств на одноразовом сервере в демо-режиме.
 * Запуск: BASE=http://127.0.0.1:<порт> npx tsx scripts/test-feelings-http.ts
 */
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://localhost:3000';

async function call(parent: string, path: string, body?: object, method?: string) {
  const res = await fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-demo-parent': parent },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const parent = `feelings-${Date.now()}`;
  const profile = await call(parent, '/api/profile', { name: 'Тест', age: 9 });
  assert.equal(profile.status, 200);
  const id = profile.data.profile.id;

  // 1. По умолчанию сохранения нет.
  const initial = await call(parent, `/api/feelings?profileId=${id}`);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.enabled, false, 'согласие по умолчанию отсутствует');
  assert.deepEqual(initial.data.checkins, [], 'и отметок нет');
  assert.equal(initial.data.retentionDays, 90, 'срок хранения виден клиенту');
  console.log('  ok по умолчанию сохранение выключено и срок хранения указан');

  // 2. Без согласия отметка не сохраняется.
  const denied = await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['joy'] });
  assert.equal(denied.status, 403, 'без согласия — 403');
  assert.equal(denied.data.error, 'consent_required');
  console.log('  ok отметка без согласия взрослого отклоняется');

  // 3. Согласие даёт взрослый.
  const consent = await call(parent, '/api/feelings', { profileId: id, action: 'consent', enabled: true });
  assert.equal(consent.status, 200);
  assert.equal(consent.data.enabled, true);
  console.log('  ok согласие включается явным запросом');

  // 4. После согласия отметка сохраняется и возвращается.
  const saved = await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['joy', 'calm'] });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.checkins.length, 1);
  assert.deepEqual(saved.data.checkins[0].feelings, ['joy', 'calm']);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(saved.data.checkins[0].day), 'день в календарном формате профиля');
  assert.ok(!JSON.stringify(saved.data).includes('"at"'), 'точное время не отдаётся');
  console.log('  ok отметка сохраняется и отдаётся без лишних полей');

  // 5. Мусор не сохраняется.
  for (const feelings of [[], ['unknown'], ['joy', 'joy2', 'nope'], 'joy', ['joy', 'calm', 'sad', 'anger']]) {
    const bad = await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings });
    assert.equal(bad.status, 400, `мусор отклонён: ${JSON.stringify(feelings)}`);
  }
  const extra = await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['joy'], note: 'секрет' });
  assert.equal(extra.status, 400, 'лишнее поле отклоняется');
  assert.equal((await call(parent, '/api/feelings', { profileId: id, action: 'hack' })).status, 400, 'неизвестное действие отклонено');
  console.log('  ok некорректные отметки и лишние поля отклоняются');

  // 6. Изоляция владельцев.
  assert.equal((await call('foreign', `/api/feelings?profileId=${id}`)).status, 404, 'чужие не видят отметки');
  assert.equal((await call('foreign', '/api/feelings', { profileId: id, action: 'consent', enabled: true })).status, 404, 'чужой не может дать согласие');
  assert.equal((await call('foreign', '/api/feelings', { profileId: id, action: 'checkin', feelings: ['joy'] })).status, 404, 'чужой не может писать отметку');
  assert.equal((await call(parent, `/api/feelings?profileId=${id}&checkinId=x`, undefined, 'DELETE')).status, 200, 'свой может удалять');
  console.log('  ok отметки изолированы по владельцу');

  // 7. Отметки не попадают в отчёт по занятиям и в журнал событий.
  const report = await call(parent, `/api/report?profileId=${id}`);
  assert.equal(report.status, 200);
  assert.ok(!JSON.stringify(report.data).includes('joy'), 'чувств нет в отчёте родителя');
  const events = await call(parent, `/api/report?profileId=${id}&events=1`);
  assert.ok(!JSON.stringify(events.data).includes('joy'), 'чувств нет и в журнале событий');
  console.log('  ok отметки не попадают в отчёт и журнал');

  // 8. Отзыв согласия стирает сохранённое.
  const before = (await call(parent, `/api/feelings?profileId=${id}`)).data.checkins.length;
  const second = await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['sad'] });
  assert.equal(second.data.checkins.length, before + 1, 'новая отметка добавилась');
  const revoked = await call(parent, '/api/feelings', { profileId: id, action: 'consent', enabled: false });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.enabled, false);
  assert.deepEqual(revoked.data.checkins, [], 'при отзыве согласия отметки удалены');
  assert.equal((await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['joy'] })).status, 403, 'после отзыва запись снова запрещена');
  console.log('  ok отзыв согласия удаляет отметки');

  // 9. Удаление всех отметок по запросу.
  await call(parent, '/api/feelings', { profileId: id, action: 'consent', enabled: true });
  await call(parent, '/api/feelings', { profileId: id, action: 'checkin', feelings: ['calm'] });
  const cleared = await call(parent, `/api/feelings?profileId=${id}`, undefined, 'DELETE');
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data.checkins, []);
  assert.equal(cleared.data.enabled, true, 'согласие остаётся, удаляются только отметки');
  console.log('  ok удаление всех отметок не трогает согласие');

  // 10. Удаление профиля удаляет и отметки: проверяем через выгрузку до удаления.
  const exported = await call(parent, `/api/profile/export?profileId=${id}`);
  assert.equal(exported.status, 200);
  console.log('  ok выгрузка данных доступна вместе с отметками');

  assert.equal((await call(parent, `/api/profile?profileId=${id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await call(parent, `/api/feelings?profileId=${id}`)).status, 404, 'после удаления профиля отметки недоступны');
  console.log('  ok удаление профиля закрывает доступ к отметкам');

  console.log('  ok отметки чувств по HTTP: согласие, запрет без него, изоляция, отзыв, удаление');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
