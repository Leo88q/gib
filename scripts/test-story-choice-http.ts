/** Run prepare / resume / final across restarts on an isolated dev server and SQLite DB. */
import fs from 'node:fs';
import { makeSupportPractice } from '../lib/content/support-practice';
import type { AgeBand } from '../lib/types';
const base = process.env.BASE ?? 'http://localhost:3000';
const marker = process.env.STORY_CHOICE_TEST_FILE ?? 'data/story-choice-test.json';
const phase = process.argv[2];
const check = (v: unknown, message: string): void => { if (!v) throw Error(message); console.log('  ok', message); };
async function request(parent: string, path: string, body?: object) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-demo-parent': parent }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json() };
}
function answer(item: any) {
  if (item.type === 'scenario') return { index: 0 };
  const x = item.instance;
  if (x.kind === 'social-practice') return { cells: [0, 1, 2] };
  if (x.kind === 'choice' || x.kind === 'cards') return { index: 0 };
  if (x.kind === 'switch-rounds') return { cells: x.rules.map(() => 0) };
  if (x.kind === 'order') return { cells: x.steps.map((_: string, i: number) => i) };
  if (x.kind === 'digits') return { digits: '1' };
  if (['memory','symbol-memory','finddiff'].includes(x.kind)) return { cells: [0] };
  if (x.kind === 'gonogo') return { targets: [] };
  throw Error('unknown task');
}
async function main() {
  if (phase === 'prepare') {
    const records = [];
    for (const age of [6, 9, 12]) {
      const parent = `story-choice-${Date.now()}-${age}`;
      const p = await request(parent, '/api/profile', { name: 'Тест', age });
      const profileId = p.data.profile.id;
      const emptyMap = await request(parent, `/api/practice-map?profileId=${profileId}`);
      check(emptyMap.status === 200 && emptyMap.data.topics.length === 7 && emptyMap.data.topics.every((t: any) => t.stories === 0), 'карта пуста до завершения');
      check((await request('other-parent', `/api/practice-map?profileId=${profileId}`)).status === 404, 'карта недоступна чужому владельцу');
      const started = await request(parent, '/api/session', { action: 'start', profileId, storyChoice: true });
      const offer = started.data.storyOffer;
      check(started.status === 200 && offer.length === 3 && new Set(offer.map((x: any) => x.id)).size === 3, `${age}: три разные карточки`);
      check(!JSON.stringify(offer).includes('"quality"') && !JSON.stringify(offer).includes('"answer"'), 'в карточках нет закрытых ответов');
      const forced = await request(parent, '/api/session', { action: 'answer', sessionId: started.data.sessionId, step: 0, answer: answer(started.data.item) });
      check(forced.status === 409 && forced.data.error === 'story_selection_required', 'начать задание до выбора нельзя');
      const resume = await request(parent, '/api/session', { action: 'start', profileId, storyChoice: true });
      check(resume.data.sessionId === started.data.sessionId && JSON.stringify(resume.data.storyOffer) === JSON.stringify(offer) && resume.data.storySelected === null, 'повтор старта не перетасовывает карточки');
      check((await request('other-parent', '/api/session', { action: 'select_story', sessionId: started.data.sessionId, cardId: offer[0].id })).status === 404, 'другой родитель не выбирает историю');
      check((await request(parent, '/api/session', { action: 'select_story', sessionId: started.data.sessionId, cardId: 'unknown' })).status === 400, 'непредложенная карточка отклонена');
      const desired = age === 6 ? 'day_1_music' : age === 9 ? 'day_1_picture' : 'day_1_default';
      records.push({ age, parent, profileId, sessionId: started.data.sessionId, offer, card: offer.find((x: any) => x.id === desired) });
    }
    fs.writeFileSync(marker, JSON.stringify(records));
  } else if (phase === 'resume') {
    const records = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const raceParent = `story-race-${Date.now()}`;
    const raceProfile = await request(raceParent, '/api/profile', { name: 'Тест', age: 8 });
    const raceStart = await request(raceParent, '/api/session', { action: 'start', profileId: raceProfile.data.profile.id, storyChoice: true });
    const choices = raceStart.data.storyOffer.slice(0, 2);
    const race = await Promise.all(choices.map((c: any) => request(raceParent, '/api/session', { action: 'select_story', sessionId: raceStart.data.sessionId, cardId: c.id })));
    check(race.filter((x: any) => x.status === 200).length === 1 && race.filter((x: any) => x.status === 409).length === 1, 'разные параллельные выборы сохраняют только одну карточку');
    for (const r of records) {
      const resumed = await request(r.parent, '/api/session', { action: 'start', profileId: r.profileId, storyChoice: true });
      check(resumed.data.resumed && resumed.data.storySelected === null && JSON.stringify(resumed.data.storyOffer) === JSON.stringify(r.offer), `${r.age}: после рестарта карточки те же`);
      const before = await request(r.parent, `/api/player?profileId=${r.profileId}`);
      const payload = { action: 'select_story', sessionId: r.sessionId, cardId: r.card.id };
      const responses = await Promise.all(Array.from({ length: 6 }, () => request(r.parent, '/api/session', payload)));
      check(responses.every((x: any) => x.status === 200 && x.data.cardId === r.card.id), 'шесть параллельных повторов подтверждают один выбор');
      const other = r.offer.find((x: any) => x.id !== r.card.id);
      check((await request(r.parent, '/api/session', { ...payload, cardId: other.id })).status === 409, 'изменённый повтор отклонён');
      const after = await request(r.parent, `/api/player?profileId=${r.profileId}`);
      check(before.data.player.xp === after.data.player.xp && before.data.player.coins === after.data.player.coins, 'сам выбор не начисляет награды');
      let current = resumed.data, step = 0;
      while (step < current.steps && !(current.done)) {
        const item = current.next ?? current.item;
        if (item.type === 'task' && item.instance.kind === 'social-practice') {
          check(item.instance.rounds.length === 3 && !JSON.stringify(item).includes('\"answer\"'), 'практика из трёх интерактивных карточек без ключа ответа');
          const band: AgeBand = r.age === 6 ? '5-7' : r.age === 9 ? '8-10' : '11-13';
          check(JSON.stringify(item.instance.rounds) === JSON.stringify(makeSupportPractice(band, r.card.scenarioId).rounds), 'возрастная практика соответствует выбранной истории');
          const bad = await request(r.parent, '/api/session', { action: 'answer', sessionId: r.sessionId, step, answer: { cells: [0] } });
          check(bad.status === 400, 'незавершённая практика не принимается');
        }
        if (item.type === 'scenario') check(item.scenarioId === r.card.scenarioId && item.variant.title === r.card.title, 'показывается именно выбранная возрастная история');
        const isPractice = item.type === 'task' && item.instance.kind === 'social-practice';
        const submission = isPractice && r.age === 6 ? { skip: true } : answer(item);
        const beforePractice = isPractice ? await request(r.parent, `/api/player?profileId=${r.profileId}`) : null;
        const result = await request(r.parent, '/api/session', { action: 'answer', sessionId: r.sessionId, step, answer: submission, ms: 100 });
        if (isPractice) {
          const afterPractice = await request(r.parent, `/api/player?profileId=${r.profileId}`);
          check(result.data.evaluation === 'not_scored' && afterPractice.data.player.xp - beforePractice!.data.player.xp === 15 && afterPractice.data.player.coins - beforePractice!.data.player.coins === 5, 'прохождение и пропуск не меняют награду');
          const replay = await request(r.parent, '/api/session', { action: 'answer', sessionId: r.sessionId, step, answer: submission, ms: 100 });
          check(replay.status === 200 && JSON.stringify(replay.data) === JSON.stringify(result.data), 'повтор практики или пропуска идемпотентен');
          const changed = await request(r.parent, '/api/session', { action: 'answer', sessionId: r.sessionId, step, answer: r.age === 6 ? { cells: [0,1,2] } : { skip: true } });
          check(changed.status === 409, 'повтор с другим выбором отклонён');
        }

        check(result.status === 200, 'шаг сохранён');
        current = { ...result.data, steps: resumed.data.steps }; step++;
        if (step === 1) {
          const exported = await request(r.parent, `/api/profile/export?profileId=${r.profileId}`);
          const active = exported.data.sessions.find((s: any) => s.id === r.sessionId);
          check(!active.inProgress.tasks[0].assisted, 'возврат до выбора не превращает первое задание в практику');
        }
      }
      check(current.done && current.reward.stars >= 1, 'миссия с выбранной историей завершена');
      const report = await request(r.parent, `/api/report?profileId=${r.profileId}`);
      check(report.data.report.supportPracticesDone === (r.age === 6 ? 0 : 1) && !JSON.stringify(report.data.report).includes('cells'), 'родитель видит участие, но не выборы ребёнка');
      const map = await request(r.parent, `/api/practice-map?profileId=${r.profileId}`);
      const topic = map.data.topics.find((t: any) => t.id === 'self_awareness');
      check(map.status === 200 && topic.stories === 1 && topic.practices === (r.age === 6 ? 0 : 1) && !JSON.stringify(map.data).includes('choice'), 'карта учитывает завершение и пропуск без раскрытия ответа');
      check((await request(r.parent, '/api/session', payload)).status === 200, 'выбор повторно подтверждается после завершения');
      const nextDay = await request(r.parent, '/api/session', { action: 'start', profileId: r.profileId, storyChoice: true });
      check(nextDay.status === 200 && nextDay.data.storyOffer?.length === 2, 'во втором дне доступны две истории');
    }
  } else if (phase === 'final') {
    const records = JSON.parse(fs.readFileSync(marker, 'utf8'));
    for (const r of records) {
      const map = await request(r.parent, `/api/practice-map?profileId=${r.profileId}`);
      const topic = map.data.topics.find((t: any) => t.id === 'self_awareness');
      check(topic.stories === 1 && topic.practices === (r.age === 6 ? 0 : 1), 'карта восстановлена после перезапуска');
      const before = await request(r.parent, `/api/player?profileId=${r.profileId}`);
      const replay = await request(r.parent, '/api/session', { action: 'select_story', sessionId: r.sessionId, cardId: r.card.id });
      const after = await request(r.parent, `/api/player?profileId=${r.profileId}`);
      check(replay.status === 200 && JSON.stringify(before.data.player) === JSON.stringify(after.data.player), `${r.age}: выбор сохранён после рестарта без повторных наград`);
      const deleted = await fetch(`${base}/api/profile?profileId=${r.profileId}`, { method: 'DELETE', headers: { 'x-demo-parent': r.parent } });
      check(deleted.status === 200 && (await request(r.parent, `/api/practice-map?profileId=${r.profileId}`)).status === 404, 'удаление профиля удаляет доступ к карте');
    }
    fs.unlinkSync(marker);
  } else throw Error('specify prepare, resume or final');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
