import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import { validateStore } from '../lib/store-validation';
import { PGlite } from '@electric-sql/pglite';
import { ensureSchema, importLegacy, type SqlClient } from '../lib/postgres/migrate';
import { startOwnedSession, selectOwnedStory, answerOwnedSession } from '../lib/postgres/session-repository';
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-story-'));
  let db = await PGlite.create(path.join(dir, 'db'));
  let client: SqlClient = { query: async (sql, values) => db.query(sql, values) };
  try {
    await ensureSchema(client);
    await importLegacy(client, { profiles: [{ id: 'p', parentId: 'owner', name: 'Тест', age: 8, band: '8-10', createdAt: 1 }, { id: 'q', parentId: 'owner-q', name: 'Тест 2', age: 6, band: '5-7', createdAt: 1 }], sessions: [], playerStates: [{ profileId: 'p', xp: 0, coins: 0, stars: 0, streak: 0, bestStreak: 0, lastActiveDay: '', badges: [], inventory: [], equipped: { head: null, body: null, pet: null, room: null }, missions: { day: 0, ids: [], progress: {}, claimed: [] }, stats: { days: 0, tasks: 0, correctTasks: 0, scenarios: 0, goodScenarios: 0, bestCombo: 0, perfectDays: 0, minutes: 0 }, startedAt: 1, family: { version: 3, completed: 1, current: { id: 'one', ideaId: 'story', catalogVersion: 1, status: 'confirmed' }, receipts: [] } }] });
    const start = await startOwnedSession(client, 'owner', 'p', false, true);
    assert.ok(!('error' in start) && start.storyOffer?.length === 3);
    const id = start.sessionId, card = start.storyOffer!.find(c => c.id === 'day_1_music')!;
    const read = async () => (await client.query('SELECT data FROM gib.sessions WHERE id=$1', [id])).rows[0].data as any;
    const before = JSON.stringify(await read());
    assert.ok(!JSON.stringify((await read()).runtime.storyVersions).includes('"quality"'));
    const originalTitle = STORYLETS_BY_ID.w1d1_music.variants['8-10'].title;
    STORYLETS_BY_ID.w1d1_music.variants['8-10'].title = 'Изменено после выдачи';

    assert.deepEqual(await answerOwnedSession(client, 'owner', id, { index: 0 }, 0, 0), { error: 'story_selection_required' });
    assert.deepEqual(await selectOwnedStory(client, 'other', id, card.id), { error: 'session_not_found' });
    assert.equal(JSON.stringify(await read()), before);
    const failing: SqlClient = { query: async (sql, values) => { if (sql.startsWith('UPDATE gib.sessions')) throw Error('injected'); return client.query(sql, values); } };
    await assert.rejects(() => selectOwnedStory(failing, 'owner', id, card.id));
    assert.equal(JSON.stringify(await read()), before);
    assert.deepEqual(await selectOwnedStory(client, 'owner', id, card.id), { ok: true, cardId: card.id });
    const saved = await read();
    assert.ok(!JSON.stringify(saved.runtime.items.filter((item: any) => item.type === 'scenario')).includes('\"quality\"'));
    assert.equal(saved.runtime.items.find((item: any) => item.type === 'scenario').scenarioId, card.scenarioId);
    assert.equal(saved.runtime.items.find((item: any) => item.type === 'scenario').content.variants['8-10'].title, originalTitle);
    STORYLETS_BY_ID.w1d1_music.variants['8-10'].title = originalTitle;
    const corrupt = structuredClone(saved);
    corrupt.runtime.plan.find((item: any) => item.type === 'scenario').scenarioId = 'forged';
    assert.throws(() => validateStore({ profiles: [], sessions: [corrupt] }), /Story selection mismatch|Invalid support practice association/);
    const duplicate = structuredClone(saved);
    duplicate.runtime.storyOffer[1].id = duplicate.runtime.storyOffer[0].id;
    assert.throws(() => validateStore({ profiles: [], sessions: [duplicate] }), /Invalid story offer/);

    assert.deepEqual(await selectOwnedStory(client, 'owner', id, card.id), { ok: true, cardId: card.id });
    assert.deepEqual(await selectOwnedStory(client, 'owner', id, 'day_1_picture'), { error: 'story_conflict' });
    await db.close(); db = await PGlite.create(path.join(dir, 'db')); client = { query: async (sql, values) => db.query(sql, values) };
    const resumed = await startOwnedSession(client, 'owner', 'p', false, true);
    assert.ok(!('error' in resumed) && resumed.storySelected === card.id && resumed.sessionId === id);
    assert.deepEqual(await selectOwnedStory(client, 'owner', id, card.id), { ok: true, cardId: card.id });
    let step = 0; let seenPractice = false;
    while (true) {
      const data = await read();
      const item = data.runtime.items[step];
      const isPractice = item.type === 'task' && item.instance.kind === 'social-practice';
      const payload = item.type === 'scenario' ? { index: 0 } : isPractice ? { cells: [0, 1, 2] } : item.instance.answer;
      const skillsBefore = isPractice ? JSON.stringify((await client.query('SELECT data FROM gib.skills WHERE profile_id=$1 ORDER BY ordinal', ['p'])).rows) : '';
      const playerBefore = isPractice ? (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data as any : null;
      if (isPractice) assert.deepEqual(await answerOwnedSession(client, 'owner', id, { cells: [0] }, 0, step), { error: 'invalid_answer' });
      const result = await answerOwnedSession(client, 'owner', id, payload, 0, step);
      assert.ok(!('error' in result));
      if (isPractice) {
        seenPractice = true;
        assert.equal(result.evaluation, 'not_scored');
        assert.equal(JSON.stringify((await client.query('SELECT data FROM gib.skills WHERE profile_id=$1 ORDER BY ordinal', ['p'])).rows), skillsBefore);
        const playerAfter = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data as any;
        assert.equal(playerAfter.xp - playerBefore.xp, 15); assert.equal(playerAfter.coins - playerBefore.coins, 5);
        assert.deepEqual(await answerOwnedSession(client, 'owner', id, payload, 0, step), JSON.parse(JSON.stringify(result)));
      }
      step++;
      if (result.done) break;
    }
    assert.ok(seenPractice); const finished = await read(); assert.equal(finished.supportPracticeCompleted, true);
    assert.ok(!Object.hasOwn(finished.scenario, 'quality'));
    assert.ok(!JSON.stringify(finished.lastReceipt).includes('\"scenarioQuality\"'));
    const preservedFamily = (await client.query('SELECT data FROM gib.player_states WHERE profile_id=$1', ['p'])).rows[0].data as any;
    assert.equal(preservedFamily.family.completed, 1); assert.equal(preservedFamily.family.current.status, 'confirmed');
    console.log('  ok PostgreSQL/PGlite: практика без оценки не изменяет навыки и начисляется один раз');
    const skipped = await startOwnedSession(client, 'owner-q', 'q', false, true);
    assert.ok(!('error' in skipped) && skipped.storyOffer);
    assert.deepEqual(await selectOwnedStory(client, 'owner-q', skipped.sessionId, skipped.storyOffer![0].id), { ok: true, cardId: skipped.storyOffer![0].id });
    const readSkipped = async () => (await client.query('SELECT data FROM gib.sessions WHERE id=$1', [skipped.sessionId])).rows[0].data as any;
    for (let i = 0; i < 3; i++) {
      const item = (await readSkipped()).runtime.items[i];
      const payload = item.type === 'scenario' ? { index: 0 } : item.instance.answer;
      assert.ok(!('error' in await answerOwnedSession(client, 'owner-q', skipped.sessionId, payload, 0, i)));
    }
    const resultSkip = await answerOwnedSession(client, 'owner-q', skipped.sessionId, { skip: true }, 0, 3);
    assert.ok(!('error' in resultSkip)); assert.equal(resultSkip.evaluation, 'not_scored');
    await db.close(); db = await PGlite.create(path.join(dir, 'db')); client = { query: async (sql, values) => db.query(sql, values) };
    assert.deepEqual(await answerOwnedSession(client, 'owner-q', skipped.sessionId, { skip: true }, 0, 3), JSON.parse(JSON.stringify(resultSkip)));
    assert.deepEqual(await answerOwnedSession(client, 'owner-q', skipped.sessionId, { cells: [0,0,0] }, 0, 3), { error: 'step_conflict' });
    const last = (await readSkipped()).runtime.items[4];
    assert.ok(!('error' in await answerOwnedSession(client, 'owner-q', skipped.sessionId, last.instance.answer, 0, 4)));
    assert.equal((await readSkipped()).supportPracticeCompleted, undefined);
    console.log('  ok PostgreSQL/PGlite: пропуск и идемпотентный повтор после перезапуска');
    console.log('  ok PostgreSQL/PGlite: владелец, откат, выбор и повтор после перезапуска');
  } finally { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
