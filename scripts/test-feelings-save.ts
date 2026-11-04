import assert from 'node:assert/strict';
import {
  addCheckIn, emptyFeelingsPreferences, pruneCheckIns, publicCheckIns, removeCheckIn,
  sanitizeFeelings, validCheckIn, validPreferences, MAX_CHECKINS, MAX_FEELINGS_PER_CHECKIN,
  CHECKIN_RETENTION_DAYS, type FeelingCheckIn,
} from '../lib/feelings/state';
import { validateStore } from '../lib/store-validation';
import { makeProfileExport } from '../lib/profile-export';
import { FEELINGS } from '../lib/content/feelings-checkin';

const now = Date.UTC(2026, 10, 4, 12, 0, 0);
const checkin = (over: Partial<FeelingCheckIn> = {}): FeelingCheckIn => ({ id: 'f_1', day: '2026-11-04', feelings: ['joy'], at: now, ...over });

// 1. По умолчанию сохранения нет: согласие — не «галочка при регистрации».
{
  const prefs = emptyFeelingsPreferences('8-10');
  assert.equal(prefs.saveEnabled, false);
  assert.equal(prefs.consentAt, undefined, 'без явного согласия нет и его метки');
  assert.ok(validPreferences(prefs));
}

// 2. Согласие с мусором не принимается.
{
  assert.equal(validPreferences({ saveEnabled: 'yes', band: '8-10' }), false);
  assert.equal(validPreferences({ saveEnabled: true, band: '9-11' }), false);
  assert.equal(validPreferences({ saveEnabled: true, band: '8-10', consentAt: Number.NaN }), false);
  assert.equal(validPreferences({ saveEnabled: true, band: '8-10', extra: 'secret' }), false);
  assert.ok(validPreferences({ saveEnabled: true, band: '8-10', consentAt: now }));
}

// 3. Отметка проверяется строго: только известные поля и чувства.
{
  assert.ok(validCheckIn(checkin()));
  assert.ok(validCheckIn(checkin({ feelings: ['joy', 'calm'] })));
  assert.equal(validCheckIn(checkin({ feelings: [] })), false, 'пустая отметка бессмысленна');
  assert.equal(validCheckIn(checkin({ feelings: ['happiness' as never] })), false, 'неизвестное чувство отклоняется');
  assert.equal(validCheckIn(checkin({ feelings: ['joy', 'joy'] })), false, 'повторы не допускаются');
  assert.equal(validCheckIn(checkin({ feelings: ['joy', 'calm', 'sad', 'anger'] })), false, `не больше ${MAX_FEELINGS_PER_CHECKIN} чувств`);
  assert.equal(validCheckIn(checkin({ day: '04.11.2026' })), false, 'день только в формате YYYY-MM-DD');
  assert.equal(validCheckIn(checkin({ at: 0 })), false);
  assert.equal(validCheckIn({ ...checkin(), note: 'секрет' }), false, 'свободный текст не хранится');
  assert.equal(validCheckIn({ ...checkin(), feelings: ['joy'], extra: 1 }), false);
}

// 4. Очистка запроса: дубли убираются, мусор отклоняется целиком.
{
  assert.deepEqual(sanitizeFeelings(['joy', 'joy', 'sad']), ['joy', 'sad']);
  assert.equal(sanitizeFeelings(['joy', 'unknown']), null, 'если хоть одно значение неизвестно — не сохраняем');
  assert.equal(sanitizeFeelings([]), null);
  assert.equal(sanitizeFeelings('joy'), null);
  assert.equal(sanitizeFeelings(['joy', 'calm', 'sad', 'anger']), null);
  assert.deepEqual(sanitizeFeelings([...FEELINGS.map(f => f.id)]), null, 'слишком много чувств');
}

// 5. Срок хранения: старые отметки исчезают.
{
  const fresh = checkin({ id: 'f_new', at: now - 5 * 86_400_000 });
  const old = checkin({ id: 'f_old', at: now - (CHECKIN_RETENTION_DAYS + 1) * 86_400_000 });
  const kept = pruneCheckIns([fresh, old], now);
  assert.deepEqual(kept.map(i => i.id), ['f_new'], 'устаревшая отметка удаляется');
  assert.deepEqual(pruneCheckIns([], now), []);
}

// 6. Лимит: старые вытесняются, ошибок и «место кончилось» нет.
{
  let items: FeelingCheckIn[] = [];
  for (let i = 0; i < MAX_CHECKINS + 5; i++) items = addCheckIn(items, checkin({ id: `f_${i}`, at: now + i }));
  assert.equal(items.length, MAX_CHECKINS, 'хранится не больше лимита');
  assert.equal(items.at(-1)!.id, `f_${MAX_CHECKINS + 4}`, 'последняя отметка сохранена');
  assert.ok(!items.some(i => i.id === 'f_0'), 'самая старая вытеснена');
}

// 7. Удаление по одной и всех сразу.
{
  const items = [checkin({ id: 'a' }), checkin({ id: 'b' })];
  assert.deepEqual(removeCheckIn(items, 'a').map(i => i.id), ['b']);
  assert.deepEqual(removeCheckIn(items, 'missing-id').map(i => i.id), ['a', 'b'], 'неизвестный id ничего не удаляет и не ломает');
}

// 8. Наружу уходят только день и чувства — без времени и служебных полей.
{
  const shown = publicCheckIns([checkin({ feelings: ['joy', 'sad'] })]);
  assert.deepEqual(Object.keys(shown[0]).sort(), ['day', 'feelings', 'id']);
  assert.ok(!JSON.stringify(shown).includes('at'), 'время события не отдаётся');
}

// 9. Испорченное состояние не проходит валидацию хранилища.
{
  const ok = { profileId: 'p', feelings: { prefs: { saveEnabled: true, band: '8-10', consentAt: now }, items: [checkin()] } };
  assert.doesNotThrow(() => validateStore({ profiles: [], sessions: [], playerStates: [ok] } as never));
  const noConsent = structuredClone(ok); noConsent.feelings.prefs.saveEnabled = false;
  assert.throws(() => validateStore({ profiles: [], sessions: [], playerStates: [noConsent] } as never), /without consent/);
  const badItem = structuredClone(ok); (badItem.feelings.items[0] as any).feelings = ['unknown'];
  assert.throws(() => validateStore({ profiles: [], sessions: [], playerStates: [badItem] } as never), /Invalid feeling check-in/);
  const dup = structuredClone(ok); dup.feelings.items.push(checkin());
  assert.throws(() => validateStore({ profiles: [], sessions: [], playerStates: [dup] } as never), /Duplicate feeling check-in/);
}

// 10. Выгрузка данных профиля содержит отметки и согласие.
{
  const profile = { id: 'p', parentId: 'owner', name: 'Тест', age: 8, band: '8-10' as const, createdAt: 1 };
  const exported = makeProfileExport({
    profile, skills: [], sessions: [], programStates: [], subs: [], payments: [],
    playerStates: [{ profileId: 'p', feelings: { prefs: { saveEnabled: true, band: '8-10', consentAt: now }, items: [checkin()] } } as never],
  } as never);
  const feelings = (exported.player[0] as any).feelings;
  assert.equal(feelings.consent.saveEnabled, true, 'согласие в выгрузке');
  assert.equal(feelings.checkins.length, 1, 'отметка в выгрузке');
  assert.equal(feelings.checkins[0].feelings[0], 'joy');
}

console.log('  ok сохранение отметок: согласие, строгая проверка, срок, лимит, удаление, выгрузка');
