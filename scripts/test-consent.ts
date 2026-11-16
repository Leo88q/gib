/**
 * Согласие законного представителя: без него ребёнок не занимается.
 *
 * Зачем тест. Согласие — единственная часть юридического минимума, которую
 * можно проверить кодом. Ошибка здесь не падает и не видна: профиль создаётся,
 * ребёнок занимается, а записи о согласии нет. Обнаружится это не тестом, а
 * претензией.
 *
 * Что проверяется:
 *  1. Профиль без согласия не создаётся (403), с чужой версией текста — тоже (409).
 *  2. Согласие сохраняется с датой и версией действующей редакции.
 *  3. Профиль, созданный до запуска (без согласия), не начинает занятие.
 *  4. Повторное согласие на новую редакцию обновляет запись.
 *  5. Устаревшее согласие отличается от отсутствующего и от действующего.
 *
 * Запуск: npm run test:consent
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Хранилище создаётся до импорта маршрутов: `store` читает `GIB_DATA_FILE` в
 * момент первого обращения, и импорт маршрута успевает это сделать раньше,
 * чем большинство тестов настроит окружение. Здесь файл задаётся до
 * статических импортов модулей приложения — поэтому они идут ниже, через
 * `await import` внутри `main`.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-consent-'));
process.env.GIB_DATA_FILE = path.join(dir, 'db.json');
(process.env as Record<string, string>).NODE_ENV = 'development';
process.env.GIB_DEMO_MODE = '1';

const request = (method: string, body?: unknown, parent = 'anna') =>
  new Request('http://localhost/api/profile', {
    method,
    headers: { 'x-demo-parent': parent, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const json = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, unknown> });

async function main() {
  const { POST, PATCH, GET } = await import('../app/api/profile/route.ts');
  const { POST: sessionPost } = await import('../app/api/session/route.ts');
  const { store } = await import('../lib/store.ts');
  const { CONSENT_VERSION, CONSENT_DATE, hasConsent, consentOutdated, newConsent } = await import('../lib/legal/consent.ts');

  /* ---- 1. Без согласия профиль не создаётся ---- */

  const noConsent = await json(await POST(request('POST', { name: 'Мира', age: 8, timeZone: 'Europe/Moscow' })));
  assert.equal(noConsent.status, 403, 'без согласия профиль не создаётся');
  assert.equal(noConsent.body.error, 'consent_required', 'отказ назван причиной, а не «неверные данные»');
  assert.equal(noConsent.body.version, CONSENT_VERSION, 'в отказе видна редакция, на которую нужно согласие');
  assert.equal(store.profilesByParent('demo:anna').length, 0, 'профиль ребёнка не появился в хранилище');

  const wrongVersion = await json(await POST(request('POST', { name: 'Мира', age: 8, consentAccepted: true, consentVersion: '2025-01-01' })));
  assert.equal(wrongVersion.status, 409, 'согласие на старую редакцию не принимается');
  assert.equal(store.profilesByParent('demo:anna').length, 0, 'профиль не создан и в этом случае');

  const notAccepted = await json(await POST(request('POST', { name: 'Мира', age: 8, consentAccepted: false, consentVersion: CONSENT_VERSION })));
  assert.equal(notAccepted.status, 403, 'явное «нет» в согласии не обходится версией текста');

  /* ---- 2. С согласием профиль создаётся и согласие сохраняется ---- */

  const created = await json(await POST(request('POST', {
    name: 'Мира', age: 8, timeZone: 'Europe/Moscow',
    consentAccepted: true, consentVersion: CONSENT_VERSION, meetingLead: 'adult', householdAdult: 'other',
  })));
  assert.equal(created.status, 200, 'с действующим согласием профиль создаётся');
  const profileId = String(created.body.profile && (created.body.profile as Record<string, unknown>).id);
  const stored = store.profile(profileId)!;
  assert.equal(stored.guardianConsent?.version, CONSENT_VERSION, 'сохранена та редакция, которую подтвердили');
  assert.ok((stored.guardianConsent?.at ?? 0) > 0, 'сохранено время согласия');
  assert.equal(stored.meetingLead, 'adult', 'режим встречи сохранён в профиле');
  assert.equal(stored.householdAdult, 'other', 'ответ про взрослого в семье сохранён');
  assert.equal((created.body.profile as Record<string, unknown>).consent instanceof Object, true, 'согласие видно клиенту как запись, а не как флаг');

  /* ---- 3. Профиль без согласия (созданный до запуска) не начинает занятие ---- */

  const legacy = { id: 'legacy-profile', parentId: 'demo:anna', name: 'Тима', age: 11, band: '11-13' as const, createdAt: Date.now() };
  store.addProfile(legacy);
  const legacyStart = await json(await sessionPost(new Request('http://localhost/api/session', {
    method: 'POST', headers: { 'x-demo-parent': 'anna', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', profileId: 'legacy-profile' }),
  })));
  assert.equal(legacyStart.status, 403, 'профиль без согласия не начинает занятие');
  assert.equal(legacyStart.body.error, 'consent_required', 'и получает ту же причину');
  assert.equal(store.sessions('legacy-profile').length, 0, 'сессия не создана: отказ до транзакции старта');

  /* ---- 4. Повторное согласие обновляет запись ---- */

  const before = store.profile(profileId)!.guardianConsent!.at;
  await new Promise(resolve => setTimeout(resolve, 5));
  const renewed = await json(await PATCH(request('PATCH', { profileId, consentAccepted: true, consentVersion: CONSENT_VERSION })));
  assert.equal(renewed.status, 200, 'согласие можно подтвердить повторно');
  assert.ok(store.profile(profileId)!.guardianConsent!.at >= before, 'дата согласия обновлена');
  const bad = await json(await PATCH(request('PATCH', { profileId, consentAccepted: true, consentVersion: '2020-01-01' })));
  assert.equal(bad.status, 409, 'повторное согласие на старую редакцию отклоняется');

  /* ---- 5. Состояния согласия различаются ---- */

  assert.equal(hasConsent({}), false, 'нет записи — нет согласия');
  assert.equal(hasConsent({ guardianConsent: newConsent() }), true, 'запись действующей редакции — согласие есть');
  assert.equal(consentOutdated({}), true, 'отсутствие согласия считается устаревшим: переспросить безопаснее');
  assert.equal(consentOutdated({ guardianConsent: { version: '2020-01-01', at: Date.now() } }), true, 'согласие на старую редакцию устарело');
  assert.equal(consentOutdated({ guardianConsent: newConsent() }), false, 'действующая редакция не устарела');
  assert.equal(hasConsent({ guardianConsent: { version: '', at: 1 } }), false, 'пустая версия не считается согласием');
  assert.equal(hasConsent({ guardianConsent: { version: CONSENT_VERSION, at: 0 } }), false, 'согласие без времени не считается');
  assert.ok(CONSENT_DATE.includes('2026'), 'дата редакции названа в тексте');

  /* ---- 6. Список профилей отдаёт состояние согласия ---- */

  const listed = await json(await GET(new Request('http://localhost/api/profile?profileId=' + profileId, { headers: { 'x-demo-parent': 'anna' } })));
  const listedProfile = listed.body.profile as Record<string, unknown>;
  assert.equal((listedProfile.consent as Record<string, unknown>).current, true, 'в списке профилей согласие помечено действующим');
  assert.equal(listedProfile.meetingLead, 'adult', 'в списке профилей виден режим встречи');
  assert.equal(listedProfile.parentId, undefined, 'идентификатор взрослого по-прежнему не отдаётся');

  console.log('✓ согласие: отказ без него, запись с датой, блокировка старого профиля');
}

main().finally(() => fs.rmSync(dir, { recursive: true, force: true }));
