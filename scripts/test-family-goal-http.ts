/**
 * HTTP-проверка общей цели семьи на одноразовом сервере.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-family-goal-http.ts
 */
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://localhost:3000';

async function api(path: string, init?: RequestInit & { parent?: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.parent) headers['x-demo-parent'] = init.parent;
  const res = await fetch(base + path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function createChild(parent: string, name: string, addChild = false) {
  const r = await api('/api/profile', { method: 'POST', parent, body: JSON.stringify({ name, age: 9, ...(addChild ? { addChild: true } : {}) }) });
  assert.equal(r.status, 200, `профиль ${name} создан`);
  return r.data.profile.id as string;
}

async function main() {
  const parent = `goal-${Date.now()}`;
  const a = await createChild(parent, 'Первый');
  const b = await createChild(parent, 'Второй', true);
  assert.notEqual(a, b, 'второй ребёнок — отдельный профиль');

  // 1. По умолчанию цель 12, вкладов нет, разбивки нет.
  const initial = await api(`/api/family-goal?profileId=${a}`, { parent });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.goal.target, 12);
  assert.equal(initial.data.goal.confirmed, 0);
  assert.deepEqual(Object.keys(initial.data.goal).sort(), ['confirmed', 'members', 'notice', 'reached', 'target']);
  assert.ok(!JSON.stringify(initial.data).includes(a), 'id ребёнка не утёк');
  assert.ok(!JSON.stringify(initial.data).includes(b), 'id второго ребёнка не утёк');
  console.log('  ok цель по умолчанию: одно число, без идентификаторов детей');

  // 2. Размер можно изменить взрослым.
  const set = await api('/api/family-goal', { method: 'POST', parent, body: JSON.stringify({ profileId: a, target: 8 }) });
  assert.equal(set.status, 200);
  assert.equal(set.data.goal.target, 8);
  assert.equal((await api(`/api/family-goal?profileId=${b}`, { parent })).data.goal.target, 8, 'размер общий на семью');
  console.log('  ok размер цели задаётся взрослым и общий для семьи');

  // 3. Недопустимые размеры отклоняются.
  for (const target of [0, 3, 5, 62, 13, '8', null]) {
    const r = await api('/api/family-goal', { method: 'POST', parent, body: JSON.stringify({ profileId: a, target }) });
    assert.equal(r.status, 400, `размер ${JSON.stringify(target)} отклонён`);
  }
  console.log('  ok недопустимые размеры отклоняются');

  // 4. Чужой профиль и чужой владелец не трогают цель.
  const foreign = await api('/api/family-goal', { method: 'POST', parent: 'stranger', body: JSON.stringify({ profileId: a, target: 20 }) });
  assert.equal(foreign.status, 404);
  const foreignRead = await api(`/api/family-goal?profileId=${a}`, { parent: 'stranger' });
  assert.equal(foreignRead.status, 404);
  assert.equal((await api(`/api/family-goal?profileId=${a}`, { parent })).data.goal.target, 8, 'цель не изменилась');
  console.log('  ok чужая семья не видит и не меняет цель');

  // 5. Отметки двух детей складываются в общее число без разбивки.
  const family = await api(`/api/family?profileId=${a}`, { parent });
  const idea = family.data.ideas?.[0];
  assert.ok(idea, 'есть семейные идеи');
  const op = (n: string) => `op-${n}-${Date.now()}`;
  const choose = await api('/api/family', { method: 'POST', parent, body: JSON.stringify({ profileId: a, action: 'choose', ideaId: idea.id, expectedVersion: family.data.version, operationId: op('choose') }) });
  assert.equal(choose.status, 200);
  const reported = await api('/api/family', { method: 'POST', parent, body: JSON.stringify({ profileId: a, action: 'report', expectedVersion: choose.data.version, operationId: op('report') }) });
  assert.equal(reported.status, 200);
  const confirmed = await api('/api/family', { method: 'POST', parent, body: JSON.stringify({ profileId: a, action: 'confirm', expectedVersion: reported.data.version, operationId: op('confirm') }) });
  assert.equal(confirmed.status, 200);
  const afterConfirm = await api(`/api/family-goal?profileId=${a}`, { parent });
  assert.equal(afterConfirm.data.goal.confirmed, 1, 'подтверждённая отметка попала в общую цель');
  assert.ok(!JSON.stringify(afterConfirm.data).includes(a), 'после начисления id всё ещё не утёк');
  console.log('  ok подтверждённая отметка входит в общее число');

  // 6. Удаление ребёнка убирает его вклад.
  assert.equal((await api(`/api/profile?profileId=${b}`, { method: 'DELETE', parent })).status, 200);
  const afterDelete = await api(`/api/family-goal?profileId=${a}`, { parent });
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.data.goal.members, 1, 'остался один ребёнок');
  console.log('  ok удаление ребёнка пересчитывает семью');

  console.log('  ok общая цель по HTTP: размер, изоляция, сумма, пересчёт');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
