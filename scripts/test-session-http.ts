/** Два запуска с перезапуском dev-сервера между ними; используется только тестовая БД. */
import fs from 'node:fs';
const base = process.env.BASE ?? 'http://localhost:3003';
const marker = process.env.SESSION_TEST_FILE ?? 'data/session-test.json';
const headers = { 'content-type': 'application/json', 'x-demo-parent': 'session-recovery-test' };
async function post(path: string, body: object) {
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); console.log('  ok', message); }
function answer(item: any) {
  if (item.type === 'scenario') return { index: 0 };
  switch (item.instance.kind) {
    case 'choice': case 'cards': return { index: 0 };
    case 'switch-rounds': return { cells: item.instance.rules.map(() => 0) };
    case 'order': return { cells: item.instance.steps.map((_: string, i: number) => i) };
    case 'digits': return { digits: '1' };
    case 'memory': case 'symbol-memory': case 'finddiff': return { cells: [0] };
    case 'gonogo': return { targets: [] };
    default: throw new Error('unknown task');
  }
}
async function main() {
  if (process.argv[2] === 'prepare') {
    const profile = await post('/api/profile', { name: 'Тест', age: 8 });
    const profileId = profile.data.profile.id;
    const start = await post('/api/session', { action: 'start', profileId });
    assert(start.status === 200 && start.data.step === 0, 'сессия начинается с нулевого шага');
    const id = start.data.sessionId;
    const report = await fetch(`${base}/api/report?profileId=${profileId}`, { headers }).then(r => r.json());
    assert(report.report.sessions === 0 && report.report.minutes === 0, 'незавершённая миссия не считается тренировкой');
    const malformed = await post('/api/session', { action: 'answer', sessionId: id, step: 0, answer: { cells: 'invalid', targets: 'invalid', index: -1, digits: 'x' } });
    assert(malformed.status === 400, 'некорректный ответ не засчитывается');
    const payload = { action: 'answer', sessionId: id, step: 0, answer: answer(start.data.item) };
    const done = await post('/api/session', payload);
    assert(done.status === 200 && !done.data.done, 'первый шаг сохранён');
    const retry = await post('/api/session', payload);
    assert(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(done.data), 'повтор шага возвращает тот же результат');
    fs.writeFileSync(marker, JSON.stringify({ profileId, sessionId: id, item: done.data.next, payload, response: done.data }));
  } else if (process.argv[2] === 'final-resume') {
    const expected = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const before = await fetch(`${base}/api/player?profileId=${expected.profileId}`, { headers }).then(r => r.json());
    const retry = await post('/api/session', expected.finalPayload);
    const after = await fetch(`${base}/api/player?profileId=${expected.profileId}`, { headers }).then(r => r.json());
    assert(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(expected.finalResponse), 'финальный результат доступен после перезапуска');
    assert(before.player.xp === after.player.xp && before.player.coins === after.player.coins && before.player.stats.days === after.player.stats.days, 'после перезапуска нет повторного начисления');
  } else {
    const expected = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const resume = await post('/api/session', { action: 'start', profileId: expected.profileId });
    assert(resume.status === 200 && resume.data.resumed, 'сессия восстановлена после перезапуска');
    assert(resume.data.sessionId === expected.sessionId && resume.data.step === 1, 'сохранён номер шага и идентификатор');
    assert(JSON.stringify(resume.data.item) === JSON.stringify(expected.item), 'сохранено то же задание');
    const retry = await post('/api/session', expected.payload);
    assert(retry.status === 200 && JSON.stringify(retry.data) === JSON.stringify(expected.response), 'результат шага восстанавливается после перезапуска без повторной награды');
    const next = await post('/api/session', { action: 'answer', sessionId: expected.sessionId, step: 1, answer: answer(resume.data.item) });
    assert(next.status === 200, 'восстановленную миссию можно продолжить');
    let current = next.data;
    let step = 2;
    while (!current.done) {
      const payload = { action: 'answer', sessionId: expected.sessionId, step, answer: answer(current.next) };
      const response = await post('/api/session', payload);
      assert(response.status === 200, 'следующий шаг успешно сохранён');
      current = response.data;
      if (current.done) {
        const before = await fetch(`${base}/api/player?profileId=${expected.profileId}`, { headers }).then(r => r.json());
        const retryLast = await post('/api/session', payload);
        const after = await fetch(`${base}/api/player?profileId=${expected.profileId}`, { headers }).then(r => r.json());
        assert(before.player.xp === after.player.xp && before.player.coins === after.player.coins && before.player.stats.days === after.player.stats.days, 'повтор не меняет опыт, монеты и количество дней');
        const report = await fetch(`${base}/api/report?profileId=${expected.profileId}`, { headers }).then(r => r.json());
        assert(report.report.sessions === 1, 'завершённая миссия отражается в отчёте один раз');
        assert(retryLast.status === 200 && JSON.stringify(retryLast.data) === JSON.stringify(current), 'финальный результат повторно доступен без двойной награды');
        const conflict = await post('/api/session', { ...payload, answer: { ...payload.answer, index: 999 } });
        assert(conflict.status === 409, 'другой ответ на последний шаг отклонён');
        fs.writeFileSync(marker, JSON.stringify({ ...expected, finalPayload: payload, finalResponse: current }));
      }
      step++;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
