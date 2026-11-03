/** Fictional profiles only; start an isolated development server first. */
const base = process.env.BASE ?? 'http://localhost:3000';
const assert = (v: unknown, text: string): void => { if (!v) throw Error(text); console.log('  ok', text); };
function taskAnswer(instance: any) {
  switch (instance.kind) {
    case 'choice': case 'cards': return { index: 0 };
    case 'switch-rounds': return { cells: instance.rules.map(() => 0) };
    case 'order': return { cells: instance.steps.map((_: string, i: number) => i) };
    case 'digits': return { digits: '1' };
    case 'memory': case 'symbol-memory': case 'finddiff': return { cells: [0] };
    case 'gonogo': return { targets: [] };
    default: throw Error('unknown task');
  }
}
async function main() {
  const deltas: { xp: number; coins: number }[] = [];
  for (let index = 0; index < 3; index++) {
    const headers = { 'content-type': 'application/json', 'x-demo-parent': `story-test-${Date.now()}-${index}` };
    async function post(path: string, body: object) { const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw Error(`HTTP ${res.status}: ${data.error}`); return data; }
    const profile = await post('/api/profile', { name: 'Тест', age: 8 });
    const started = await post('/api/session', { action: 'start', profileId: profile.profile.id });
    let item = started.item; let step = 0; let before: any = { xp: 0, coins: 0, combo: 0 };
    while (item.type !== 'scenario') {
      const reply = await post('/api/session', { action: 'answer', sessionId: started.sessionId, step, answer: taskAnswer(item.instance), ms: 100 });
      before = reply.reward; item = reply.next; step++;
    }
    const payload = { action: 'answer', sessionId: started.sessionId, step, answer: { index }, ms: 0 };
    const reply = await post('/api/session', payload);
    const replay = await post('/api/session', payload);
    assert(JSON.stringify(reply) === JSON.stringify(replay), 'повтор истории возвращает ту же квитанцию');
    assert(reply.reward.combo === before.combo && !reply.goodNote && reply.evaluation === 'not_scored', 'история не оценивается, не меняет серию и не навязывает лучший ответ');
    deltas.push({ xp: reply.reward.xp - before.xp, coins: reply.reward.coins - before.coins });
  }
  assert(deltas.every(value => JSON.stringify(value) === JSON.stringify(deltas[0])) && deltas[0].xp > 0 && deltas[0].coins > 0, 'три позиции вариантов дают одинаковую награду за участие');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
