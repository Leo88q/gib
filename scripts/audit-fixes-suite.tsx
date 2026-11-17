import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import Room from '../components/Room.tsx';
import Shop from '../components/Shop.tsx';
import ExerciseFrame from '../components/ExerciseFrame.tsx';
import PracticeMap from '../components/PracticeMap.tsx';
import AdminDashboard from '../components/AdminDashboard.tsx';
import LessonReminderSettings from '../components/LessonReminderSettings.tsx';
import VideoConsentControl from '../components/VideoConsentControl.tsx';
import ChildStudioCard from '../components/ChildStudioCard.tsx';
import { paywallCopy } from '../lib/access/entitlement.ts';
import { SHOP } from '../lib/gamification.ts';
import { resolveOperator, legalMissing, legalReady } from '../lib/legal/documents.ts';
import { computeInterRaterReliability } from '../lib/research/coding.ts';
import Hud from '../components/Hud.tsx';
import { JOURNEY_STORY_CARDS, selectStoryCards } from '../lib/day/story-deck.ts';
import { isMuted, onMuteChange, setMuted } from '../lib/sound.ts';
import {
  FQS_ITEMS,
  FQS_DIMENSIONS,
  computeCronbachAlpha,
  parseAndScoreFqsItems,
  summarizeFqsResponses,
  type FqsResponseRecord,
} from '../lib/research/fqs.ts';
import { listFqsResponses, saveFqsResponse, purgeProfileFqsLinks } from '../lib/research/fqs-store.ts';
import { buildDatasetRows, buildXapiStatements, rowsToCsv } from '../lib/research/export.ts';

function signTelegramInitData(botToken: string, userId: number): string {
  const authDate = Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify({ id: userId, first_name: 'Анна' });
  const pairs = [`auth_date=${authDate}`, `user=${userJson}`].sort().join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(pairs).digest('hex');
  const params = new URLSearchParams({ auth_date: String(authDate), user: userJson, hash });
  return params.toString();
}

async function main() {
  /* ---- 1. Проверка разметки Дизайна v2 + стадии роста 3D-питомца + прозрачный альфа-канал предметов ---- */
  const crown = SHOP.find((i) => i.variant === 'crown')!;
  const roomBaby = renderToStaticMarkup(
    <Room
      hero="/art/v2/creatures/mira-face.png"
      heroName="Мира"
      pet="cat"
      petLevel={1}
      petMood="happy"
      equippedItems={[{ id: crown.id, name: crown.name, variant: crown.variant, slot: 'head' }]}
    />,
  );
  const roomTeen = renderToStaticMarkup(
    <Room
      hero="/art/v2/creatures/mira-face.png"
      heroName="Мира"
      pet="cat"
      petLevel={3}
      petMood="happy"
      equippedItems={[{ id: crown.id, name: crown.name, variant: crown.variant, slot: 'head' }]}
    />,
  );
  const roomAdult = renderToStaticMarkup(
    <Room
      hero="/art/v2/creatures/mira-face.png"
      heroName="Мира"
      pet="cat"
      petLevel={6}
      petMood="happy"
      equippedItems={[{ id: crown.id, name: crown.name, variant: crown.variant, slot: 'head' }]}
    />,
  );
  assert.ok(roomBaby.includes('/art/v2/creatures/pet.png'), 'Room lvl 1 рендерит малыша 3D-питомца v2');
  assert.ok(roomTeen.includes('/art/v2/creatures/pet-teen.png'), 'Room lvl 3 рендерит подросшего 3D-питомца v2');
  assert.ok(roomAdult.includes('/art/v2/creatures/pet-adult.png'), 'Room lvl 6 рендерит взрослого 3D-питомца v2');
  assert.ok(roomBaby.includes('/art/v2/items/crown.png'), 'Room рендерит надетый 3D-предмет');

  // Проверяем PNG IHDR colorType === 6 (RGBA с прозрачным фоном) у всех 19 предметов
  const itemsDir = path.join(process.cwd(), 'public', 'art', 'v2', 'items');
  const itemPngs = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.png'));
  assert.equal(itemPngs.length, 19, 'в public/art/v2/items ровно 19 PNG');
  for (const file of itemPngs) {
    const header = fs.readFileSync(path.join(itemsDir, file)).subarray(0, 29);
    const colorType = header[25];
    assert.equal(colorType, 6, `${file} имеет RGBA альфа-канал (colorType=6)`);
  }

  const shopHtml = renderToStaticMarkup(
    <Shop
      items={SHOP}
      coins={150}
      inventory={[crown.id]}
      equipped={{ head: crown.id, body: null, pet: 'cat', room: null }}
      level={2}
      band="8-10"
      onBuy={() => {}}
      onEquip={() => {}}
    />,
  );
  assert.ok(shopHtml.includes('/art/v2/creatures/mira.png'), 'Shop показывает 3D-проводника возрастной линейки');
  assert.ok(shopHtml.includes('/art/v2/creatures/pet.png'), 'Shop показывает 3D-питомца v2');
  assert.ok(!shopHtml.includes('shop-avatar'), 'Shop больше не рендерит старого плоского 2D-мальчика');

  // Проверка SSR-рендера новых компонентов Части 1
  const adminHtml = renderToStaticMarkup(<AdminDashboard />);
  assert.ok(adminHtml.includes('Панель управления и исследования'), 'AdminDashboard рендерит заголовок');
  const reminderHtml = renderToStaticMarkup(<LessonReminderSettings profileId="p_test" />);
  assert.ok(reminderHtml.includes('Напоминание за день до встречи'), 'LessonReminderSettings рендерит заголовок');
  const consentHtml = renderToStaticMarkup(<VideoConsentControl profileId="p_test" />);
  assert.ok(consentHtml.includes('Съёмка очного показа для исследования'), 'VideoConsentControl рендерит заголовок');
  const studioEmptyHtml = renderToStaticMarkup(<ChildStudioCard profileId="p_test" />);
  assert.equal(studioEmptyHtml, '', 'ChildStudioCard скрыт по умолчанию без очной группы');

  /* ---- 1b. Реквизиты оператора из переменных окружения + математика IRR ---- */
  const fullEnvOperator = resolveOperator({
    GIB_OPERATOR_NAME: 'ООО «Город Историй»',
    GIB_OPERATOR_REGISTRATION: 'ИНН 7701234567 · ОГРН 1237700123456',
    GIB_OPERATOR_ADDRESS: '101000, г. Москва, ул. Примерная, д. 1',
    GIB_OPERATOR_EMAIL: 'privacy@gorod-istoriy.ru',
  });
  assert.deepEqual(legalMissing(fullEnvOperator), [], 'все реквизиты оператора закрываются через GIB_OPERATOR_*');
  assert.equal(legalReady(fullEnvOperator), true);

  const irrPerfect = computeInterRaterReliability(
    ([0, 1, 2, 1, 2] as const).map((score, idx) => ({
      sampleId: `s_${idx}`,
      profileId: null,
      participantHash: `subj_${idx}`,
      ageBand: '8-10' as const,
      lesson: 3,
      stage: 'entry' as const,
      raterA: { raterId: 'a', score, codedAt: 1 },
      raterB: { raterId: 'b', score, codedAt: 1 },
      createdAt: 1,
      updatedAt: 1,
    })),
  );
  assert.equal(irrPerfect.observedAgreement, 1);
  assert.equal(irrPerfect.cohenKappa, 1);
  assert.equal(irrPerfect.weightedKappa, 1);
  assert.equal(irrPerfect.gwetAc1, 1);

  const frameGonogo = renderToStaticMarkup(
    <ExerciseFrame kind="gonogo" band="8-10" instruction="Инструкция">
      <div>Тест</div>
    </ExerciseFrame>,
  );
  const frameCards = renderToStaticMarkup(
    <ExerciseFrame kind="cards" band="5-7" instruction="Инструкция">
      <div>Тест</div>
    </ExerciseFrame>,
  );
  assert.ok(frameGonogo.includes('/art/v2/items/hourglass.png'), 'ExerciseFrame рендерит 3D песочные часы для gonogo');
  assert.ok(frameCards.includes('/art/v2/items/cards.png'), 'ExerciseFrame рендерит 3D карточки для cards');

  const mapHtml = renderToStaticMarkup(<PracticeMap profileId="p_test" />);
  assert.ok(mapHtml.includes('/art/v2/places/map.png'), 'PracticeMap рендерит панораму /art/v2/places/map.png');
  console.log('  ok Дизайн v2: 3D-питомец, надетые вещи, гардероб без 2D-аватара, 3D-предметы упражнений и map.png');

  /* ---- 2. Paywall в режиме «ребёнок сам» ---- */
  const meetingCopy = paywallCopy('meetings_not_in_mode');
  const sessionCopy = paywallCopy('meetings_not_in_mode', 'session');
  assert.ok(meetingCopy.title.includes('не входят'), 'контекст встречи сохранён для кабинета');
  assert.ok(!sessionCopy.title.includes('не входят') && sessionCopy.title.includes('по подписке'), 'контекст тренажёра честно объясняет подписку');
  console.log('  ok Paywall в режиме «ребёнок сам» различает план встречи и запуск миссии');

  /* ---- 3. Полная проверка PostgreSQL (группы, педагог, удаление платного профиля, реестр, возвраты, сессии, боты) ---- */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-audit-pg-'));
  try {
    const childScript = path.join(tmp, 'pg-runner.ts');
    const tgToken = '999888777:' + 'T'.repeat(35);
    const parentInit = signTelegramInitData(tgToken, 500101);
    const teacherInit = signTelegramInitData(tgToken, 500202);

    fs.writeFileSync(
      childScript,
      `
import assert from 'node:assert/strict';
import { store } from '${process.cwd()}/lib/store.ts';
import { openBridge } from '${process.cwd()}/lib/postgres/state-backend.ts';
import { calculateRefundAmount } from '${process.cwd()}/lib/billing.ts';
import { GET as teacherGet, POST as teacherPost, PUT as teacherPut } from '${process.cwd()}/app/api/teacher/route.ts';
import { GET as lessonsGet, POST as lessonsPost } from '${process.cwd()}/app/api/lessons/route.ts';
import { POST as pinPost, DELETE as pinDelete } from '${process.cwd()}/app/api/parent-pin/route.ts';
import { GET as authGet, POST as authPost } from '${process.cwd()}/app/api/auth/session/route.ts';
import { POST as linkPost } from '${process.cwd()}/app/api/auth/link/route.ts';
import { POST as tgWebhook } from '${process.cwd()}/app/api/telegram/webhook/route.ts';
import { POST as maxWebhook } from '${process.cwd()}/app/api/max/webhook/route.ts';
import { GET as remindersGet, POST as remindersPost } from '${process.cwd()}/app/api/lesson-reminders/route.ts';
import { GET as consentGet, POST as consentPost } from '${process.cwd()}/app/api/video-consent/route.ts';
import { GET as adminOverviewGet } from '${process.cwd()}/app/api/admin/overview/route.ts';
import { GET as adminExportGet } from '${process.cwd()}/app/api/admin/export/route.ts';
import { GET as adminResearchGet, POST as adminResearchPost } from '${process.cwd()}/app/api/admin/research/route.ts';
import { dispatchDueNotifications } from '${process.cwd()}/lib/bots/messenger.ts';
import { pingAsyncPool, readAnalyticsSnapshotAsync, closeAsyncPool } from '${process.cwd()}/lib/postgres/async-pool.ts';
import { YEAR } from '${process.cwd()}/lib/content/year/index.ts';
import { startOwnedSessionRowLevel, selectOwnedStoryRowLevel, answerOwnedSessionRowLevel, ConcurrentRowVersionError, ensureRowLevelSchema } from '${process.cwd()}/lib/postgres/row-writer.ts';

const PARENT_INIT = ${JSON.stringify(parentInit)};
const TEACHER_INIT = ${JSON.stringify(teacherInit)};

async function run() {
  // A. Создание группы педагогом в PostgreSQL + вступление родителя + отметка занятия и показа без предварительного входа в /parent
  const createRes = await teacherPut(new Request('http://localhost/api/teacher', {
    method: 'PUT',
    headers: { 'x-telegram-init-data': TEACHER_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '3А класс' }),
  }));
  assert.equal(createRes.status, 200);
  const { group } = await createRes.json();
  assert.equal(group.joinCode.length, 8);

  const now = Date.now();
  store.addProfile({
    id: 'p_paid_pg',
    parentId: '500101',
    name: 'Алиса',
    age: 9,
    band: '8-10',
    createdAt: now,
  });

  const joinRes = await teacherPost(new Request('http://localhost/api/teacher', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'join', code: group.joinCode, profileId: 'p_paid_pg' }),
  }));
  assert.equal(joinRes.status, 200);

  const parentGroupsRes = await teacherGet(new Request('http://localhost/api/teacher?profileId=p_paid_pg', {
    headers: { 'x-telegram-init-data': PARENT_INIT },
  }));
  assert.equal(parentGroupsRes.status, 200);
  const parentGroups = await parentGroupsRes.json();
  assert.equal(parentGroups.memberships.length, 1);

  // Педагог читает /api/lessons для ученика своей группы и видит расписание без домашнего отчёта
  const lessonsRes = await lessonsGet(new Request('http://localhost/api/lessons?profileId=p_paid_pg', {
    headers: { 'x-telegram-init-data': TEACHER_INIT },
  }));
  assert.equal(lessonsRes.status, 200);
  const teacherLessons = await lessonsRes.json();
  assert.equal(teacherLessons.lessons.length, 36);
  assert.equal(teacherLessons.page, undefined, 'педагогу не утекает домашний отчёт');
  assert.equal(teacherLessons.access, undefined, 'педагогу не утекает статус оплаты');

  // Родитель видит groupInfo + managedByGroup и не может перезаписать отметку педагога
  const parentLessonsRes = await lessonsGet(new Request('http://localhost/api/lessons?profileId=p_paid_pg', {
    headers: { 'x-telegram-init-data': PARENT_INIT },
  }));
  const parentLessons = await parentLessonsRes.json();
  assert.equal(parentLessons.managedByGroup, true);
  assert.equal(parentLessons.groupInfo?.id, group.id);
  const forbiddenParentMark = await lessonsPost(new Request('http://localhost/api/lessons', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'p_paid_pg', lesson: 1, attended: false }),
  }));
  assert.equal(forbiddenParentMark.status, 403);

  const markRes = await teacherPost(new Request('http://localhost/api/teacher', {
    method: 'POST',
    headers: { 'x-telegram-init-data': TEACHER_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'mark', profileId: 'p_paid_pg', lesson: 1, attended: true }),
  }));
  assert.equal(markRes.status, 200);

  // B. Расчёт возвратов (14 дней / 0 занятий vs пропорциональный остаток vs истечение 30 дней)
  const appliedAt = now - 5 * 86_400_000;
  const payment = {
    id: 'pay_audit_1',
    profileId: 'p_paid_pg',
    plan: 'month' as const,
    amount: '599.00',
    currency: 'RUB' as const,
    days: 30,
    status: 'succeeded' as const,
    providerId: 'yk_1',
    idempotenceKey: 'idem_1',
    createdAt: appliedAt,
    updatedAt: appliedAt,
    appliedAt,
    receiptEmail: 'parent@example.ru',
    offerVersion: '2026-04-16',
  };
  store.savePayment(payment);

  const fullCalc = calculateRefundAmount(payment, { now });
  assert.equal(fullCalc.kind, 'full');
  assert.equal(fullCalc.amount, '599.00');

  const after15d = calculateRefundAmount(payment, { now: appliedAt + 15 * 86_400_000 });
  assert.equal(after15d.kind, 'prorata');
  assert.equal(after15d.unusedDays, 15);
  assert.equal(after15d.amount, '299.50');

  store.addSession({
    id: 'sess_paid_1',
    profileId: 'p_paid_pg',
    startedAt: appliedAt + 1000,
    finishedAt: appliedAt + 60_000,
    seconds: 59,
    tasks: [],
    plan: [],
  });
  const afterSession = calculateRefundAmount(payment, { now });
  assert.equal(afterSession.kind, 'prorata');
  assert.equal(afterSession.unusedDays, 25);
  assert.equal(afterSession.amount, '499.17');

  assert.throws(
    () => calculateRefundAmount(payment, { now: appliedAt + 31 * 86_400_000 }),
    /refund_period_expired/,
  );

  // C. Удаление платного профиля в PostgreSQL + обезличенный реестр gib.payment_ledger
  store.deleteProfile('p_paid_pg');
  assert.equal(store.profile('p_paid_pg'), undefined);
  const bridge = openBridge();
  const ledgerRows = bridge.query('SELECT * FROM gib.payment_ledger WHERE payment_id = $1', ['pay_audit_1']);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].amount, '599.00');
  assert.equal(ledgerRows[0].profile_id, undefined, 'в реестре нет персональных ссылок на ребёнка');

  // D. Серверная защита PIN: без куки нельзя снести PIN через DELETE /api/parent-pin
  const setPinRes = await pinPost(new Request('http://localhost/api/parent-pin', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set', pin: '5839' }),
  }));
  assert.equal(setPinRes.status, 200);

  const unauthDel = await pinDelete(new Request('http://localhost/api/parent-pin', {
    method: 'DELETE',
    headers: { 'x-telegram-init-data': PARENT_INIT },
  }));
  assert.equal(unauthDel.status, 401, 'ребёнок без подтверждённого PIN не может удалить код');

  const verifyPinRes = await pinPost(new Request('http://localhost/api/parent-pin', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'verify', pin: '5839' }),
  }));
  assert.equal(verifyPinRes.status, 200);
  const gateCookie = verifyPinRes.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(gateCookie.startsWith('gib_parent_gate='));

  const authDel = await pinDelete(new Request('http://localhost/api/parent-pin', {
    method: 'DELETE',
    headers: { 'x-telegram-init-data': PARENT_INIT, cookie: gateCookie },
  }));
  assert.equal(authDel.status, 200);

  // E. Серверная сессия gib_session + 6-значный код привязки браузера + вход по почте
  const exchRes = await authPost(new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'exchange' }),
  }));
  assert.equal(exchRes.status, 200);
  const sessionCookie = exchRes.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(sessionCookie.startsWith('gib_session='));

  const checkSession = await authGet(new Request('http://localhost/api/auth/session', {
    headers: { cookie: sessionCookie },
  }));
  assert.equal(checkSession.status, 200);
  assert.equal((await checkSession.json()).channel, 'telegram');

  const codeCreate = await linkPost(new Request('http://localhost/api/auth/link', {
    method: 'POST',
    headers: { 'x-telegram-init-data': TEACHER_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create_code' }),
  }));
  const { code } = await codeCreate.json();
  assert.match(code, /^\\d{6}$/);

  const codeRedeem = await linkPost(new Request('http://localhost/api/auth/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'redeem_code', code }),
  }));
  assert.equal(codeRedeem.status, 200);
  assert.ok(codeRedeem.headers.get('set-cookie')?.includes('gib_session='));

  const codeReplay = await linkPost(new Request('http://localhost/api/auth/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'redeem_code', code }),
  }));
  assert.equal(codeReplay.status, 401, 'одноразовый код нельзя использовать повторно');

  const otpReq = await authPost(new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'request_email_code', email: 'family@example.ru' }),
  }));
  const otpData = await otpReq.json();
  assert.equal(otpReq.status, 200);
  assert.match(otpData.previewCode, /^\\d{6}$/);

  const otpVerify = await authPost(new Request('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'verify_email_code', email: 'family@example.ru', code: otpData.previewCode }),
  }));
  assert.equal(otpVerify.status, 200);

  // F. Вебхуки Telegram и MAX + планировщик отчётов
  const badWebhook = await tgWebhook(new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 500101, type: 'private' }, from: { id: 500101 }, text: '/start' } }),
  }));
  assert.equal(badWebhook.status, 401);

  store.addProfile({ id: 'p_notify_1', parentId: '500101', name: 'Лев', age: 7, band: '5-7', createdAt: now });
  store.setNotificationSettings('500101', { enabled: true, frequency: 'weekly', lastSentAt: null });

  const delivered: string[] = [];
  const summary = await dispatchDueNotifications({
    now,
    transport: (async (_url: unknown, init?: RequestInit) => {
      delivered.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(summary.sent, 1);
  assert.equal(delivered.length, 1);
  assert.ok(delivered[0].includes('Лев'));

  const secondDispatch = await dispatchDueNotifications({
    now: now + 60_000,
    transport: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
  });
  assert.equal(secondDispatch.sent, 0, 'повторная рассылка раньше недели пропускается');

  // G. Напоминания об очной встрече (Item 4) + cron-рассылка без повторного спама
  const tomorrowIso = new Date(now + 24 * 3600_000).toISOString().slice(0, 10);
  const lionState = store.programState('p_notify_1');
  store.setProgramState({
    ...lionState,
    startedAt: now,
    lessons: [{ lesson: 1, date: tomorrowIso }],
  });
  const remPost = await remindersPost(new Request('http://localhost/api/lesson-reminders', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'p_notify_1', enabled: true }),
  }));
  assert.equal(remPost.status, 200);
  const remGet = await remindersGet(new Request('http://localhost/api/lesson-reminders?profileId=p_notify_1', {
    headers: { 'x-telegram-init-data': PARENT_INIT },
  }));
  assert.equal((await remGet.json()).reminder.enabled, true);

  const reminderMessages: string[] = [];
  const remDispatch1 = await dispatchDueNotifications({
    now,
    transport: (async (_url: unknown, init?: RequestInit) => {
      reminderMessages.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(remDispatch1.remindersSent, 1);
  assert.ok(reminderMessages[0].includes('Лев'));

  const remDispatch2 = await dispatchDueNotifications({
    now: now + 120_000,
    transport: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
  });
  assert.equal(remDispatch2.remindersSent, 0, 'напоминание на одну и ту же встречу не дублируется');

  // H. Отдельное видеосогласие + двойное слепое кодирование + IRR + обезличивание при отзыве (Item 9)
  const showcaseLessonNum = YEAR.lessons.find((l) => l.isShowcase)!.number;
  const noConsentCode = await adminResearchPost(new Request('http://localhost/api/admin/research', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create_sample',
      profileId: 'p_notify_1',
      lesson: showcaseLessonNum,
    }),
  }));
  assert.equal(noConsentCode.status, 403, 'без видеосогласия создание образца с profileId заблокировано');

  const grantConsent = await consentPost(new Request('http://localhost/api/video-consent', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'p_notify_1', granted: true }),
  }));
  assert.equal(grantConsent.status, 200);
  const checkConsent = await consentGet(new Request('http://localhost/api/video-consent?profileId=p_notify_1', {
    headers: { 'x-telegram-init-data': PARENT_INIT },
  }));
  assert.equal((await checkConsent.json()).granted, true);

  const createSampleRes = await adminResearchPost(new Request('http://localhost/api/admin/research', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create_sample',
      profileId: 'p_notify_1',
      lesson: showcaseLessonNum,
    }),
  }));
  assert.equal(createSampleRes.status, 200);
  const { sample } = await createSampleRes.json();

  const rateARes = await adminResearchPost(new Request('http://localhost/api/admin/research', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'submit_rating',
      sampleId: sample.sampleId,
      slot: 'rater_a',
      raterId: 'rater_a',
      score: 2,
    }),
  }));
  assert.equal(rateARes.status, 200);

  // Слепой режим: оценщик B до сдачи своей оценки не видит оценку A
  const blindRes = await adminResearchGet(new Request('http://localhost/api/admin/research?blindSlot=rater_b', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  const blindPayload = await blindRes.json();
  assert.equal(blindPayload.samples[0].raterA.score, undefined, 'оценка A скрыта от B до сдачи парной оценки');

  const rateBRes = await adminResearchPost(new Request('http://localhost/api/admin/research', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'submit_rating',
      sampleId: sample.sampleId,
      slot: 'rater_b',
      raterId: 'rater_b',
      score: 2,
    }),
  }));
  assert.equal(rateBRes.status, 200);

  const researchSummaryRes = await adminResearchGet(new Request('http://localhost/api/admin/research', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  assert.equal(researchSummaryRes.status, 200);
  const researchSummary = await researchSummaryRes.json();
  assert.equal(researchSummary.samples.length, 1);
  assert.equal(researchSummary.report.reliability.pairedCount, 1);
  assert.equal(researchSummary.report.reliability.observedAgreement, 1);
  assert.equal(researchSummary.report.constructCoverage.byConstruct.length, 6);

  // Отзыв согласия полностью удаляет записи видеокодирования этого профиля из PostgreSQL (152-ФЗ)
  const revokeRes = await consentPost(new Request('http://localhost/api/video-consent', {
    method: 'POST',
    headers: { 'x-telegram-init-data': PARENT_INIT, 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: 'p_notify_1', granted: false }),
  }));
  assert.equal(revokeRes.status, 200);
  assert.equal((await revokeRes.json()).purgedSamples, 1);
  const pgCodings = bridge.query('SELECT profile_id FROM gib.research_codings', []);
  assert.equal(pgCodings.length, 0, 'после отзыва согласия записи видеокодирования удалены из PostgreSQL');

  // Регистрируем обезличенный образец без привязки к profileId для проверки аналитического снимка
  const anonSampleRes = await adminResearchPost(new Request('http://localhost/api/admin/research', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret-token-1234567890', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create_sample',
      anonymousKey: 'cohort_2026_01',
      ageBand: '5-7',
      lesson: showcaseLessonNum,
    }),
  }));
  assert.equal(anonSampleRes.status, 200);

  // I. Панель /api/admin/overview + обезличенный экспорт CSV / JSON / xAPI 1.0.3 (Items 2 & 8)
  const unauthAdmin = await adminOverviewGet(new Request('http://localhost/api/admin/overview'));
  assert.equal(unauthAdmin.status, 404, 'без токена админ-маршрут отвечает 404');

  const overviewRes = await adminOverviewGet(new Request('http://localhost/api/admin/overview', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.ok(overview.accounts.profiles >= 1);
  assert.equal(overview.billing.archivedLedgerRows, 1);

  store.addSession({
    id: 'sess_export_1',
    profileId: 'p_notify_1',
    startedAt: now - 120_000,
    finishedAt: now - 60_000,
    seconds: 60,
    tasks: [{ taskId: 't_1', skillId: 'name_feeling', domain: 'emotion', correct: true, ms: 2400 }],
    plan: ['emotion'],
  });

  const exportJsonRes = await adminExportGet(new Request('http://localhost/api/admin/export?dataset=sessions&format=json', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  assert.equal(exportJsonRes.status, 200);
  const exportJsonText = await exportJsonRes.text();
  assert.ok(!exportJsonText.includes('Лев'), 'экспорт не содержит имени ребёнка');
  assert.ok(!exportJsonText.includes('p_notify_1'), 'экспорт не содержит сырого profileId');
  const exportDataset = JSON.parse(exportJsonText);
  assert.ok(exportDataset.rows.some((r: { participant_hash: string }) => /^[0-9a-f]{12}$/.test(r.participant_hash)));

  const exportCsvRes = await adminExportGet(new Request('http://localhost/api/admin/export?dataset=sessions&format=csv', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  assert.equal(exportCsvRes.status, 200);
  const exportCsvText = await exportCsvRes.text();
  assert.ok(exportCsvText.startsWith('participant_hash,'));
  assert.ok(!exportCsvText.includes('Лев'));

  const exportXapiRes = await adminExportGet(new Request('http://localhost/api/admin/export?dataset=sessions&format=xapi', {
    headers: { authorization: 'Bearer admin-secret-token-1234567890' },
  }));
  assert.equal(exportXapiRes.status, 200);
  const xapiPayload = await exportXapiRes.json();
  assert.equal(xapiPayload.version, '1.0.3');
  assert.ok(xapiPayload.statements.length >= 1);
  assert.equal(xapiPayload.statements[0].version, '1.0.3');

  // J. Асинхронный пул pg.Pool (Item 10): проверка пула и REPEATABLE READ аналитического снимка PostgreSQL
  const unconfiguredPing = await pingAsyncPool({});
  assert.equal(unconfiguredPing.enabled, false);
  assert.equal(unconfiguredPing.ok, true);

  const asyncSnap = await readAnalyticsSnapshotAsync({}, {
    async query(sql: string, params?: unknown[]) {
      const rows = bridge.query(sql, params ?? []);
      return { rows: rows as never[], rowCount: rows.length };
    },
  });
  assert.ok(asyncSnap && asyncSnap.profiles.length >= 1);
  assert.equal(asyncSnap.ledgerCount, 1);
  assert.equal(asyncSnap.researchCodingsCount, 1);
  await closeAsyncPool();

  // K. Построчный асинхронный писатель (lib/postgres/row-writer.ts): версии строк, последовательности, откат при конфликте
  const asyncClient = {
    async query(sql: string, params?: unknown[]) {
      return { rows: bridge.query(sql, params ?? []) as never[], rowCount: undefined as never };
    },
  };
  await ensureRowLevelSchema(asyncClient);
  store.addProfile({ id: 'p_row_1', parentId: '500101', name: 'Мира', age: 9, band: '8-10', createdAt: now });
  const rowStart = await startOwnedSessionRowLevel(asyncClient, '500101', 'p_row_1', { journey: true, storyChoice: true });
  assert.ok(!('error' in rowStart), 'построчный старт создаёт сессию');
  assert.ok('started' in rowStart && Array.isArray(rowStart.started.storyOffer) && rowStart.started.storyOffer.length === 3, 'Journey v2 через построчный путь предлагает три истории');
  const rowSessionId = rowStart.started.sessionId;
  const eventsAfterStart = Number(bridge.query('SELECT COUNT(*)::int AS c FROM gib.events WHERE profile_id = $1', ['p_row_1'])[0].c);
  assert.equal(eventsAfterStart, 1, 'старт фиксируется ровно одним событием');

  const rowPick = await selectOwnedStoryRowLevel(asyncClient, '500101', rowSessionId, rowStart.started.storyOffer[0].id);
  assert.ok(!('error' in rowPick), 'выбор истории через построчный путь принят');
  const eventsAfterPick = Number(bridge.query('SELECT COUNT(*)::int AS c FROM gib.events WHERE profile_id = $1', ['p_row_1'])[0].c);
  assert.equal(eventsAfterPick, eventsAfterStart + 1, 'выбор истории фиксируется событием story_selected');

  // Конкурентная запись между чтением и обновлением → отказ по версии строки и полный откат транзакции
  const beforeVersion = Number(bridge.query('SELECT row_version FROM gib.sessions WHERE id = $1', [rowSessionId])[0].row_version);
  let bumpedOnce = false;
  const racedClient = {
    async query(sql: string, params?: unknown[]) {
      if (!bumpedOnce && /^\s*UPDATE gib\.sessions/i.test(sql)) {
        bumpedOnce = true;
        // Иная «реплика» успевает закоммитить строку первой: версия уехала вперёд.
        bridge.query('UPDATE gib.sessions SET row_version = row_version + 1 WHERE id = $1', [rowSessionId]);
      }
      return { rows: bridge.query(sql, params ?? []) as never[], rowCount: undefined as never };
    },
  };
  const sessionRow = bridge.query('SELECT data FROM gib.sessions WHERE id = $1', [rowSessionId])[0].data as { runtime: { index: number } };
  const raceStep = sessionRow.runtime.index;
  await assert.rejects(
    () => answerOwnedSessionRowLevel(racedClient, '500101', rowSessionId, { index: 0 }, 150, raceStep),
    (err: unknown) => err instanceof ConcurrentRowVersionError,
    'расхождение row_version отклоняется (ConcurrentRowVersionError), частичные записи откачены',
  );
  const afterVersion = Number(bridge.query('SELECT row_version FROM gib.sessions WHERE id = $1', [rowSessionId])[0].row_version);
  assert.equal(afterVersion, beforeVersion, 'после отката row_version не изменился');
  const eventsAfterRace = Number(bridge.query('SELECT COUNT(*)::int AS c FROM gib.events WHERE profile_id = $1', ['p_row_1'])[0].c);
  assert.equal(eventsAfterRace, eventsAfterPick, 'после отката новых событий нет');

  // Обычный ответ через построчный путь проходит и двигает row_version
  const rowAnswer = await answerOwnedSessionRowLevel(asyncClient, '500101', rowSessionId, { index: 0 }, 150, raceStep);
  assert.ok(!('error' in rowAnswer), 'ответ через построчный путь принят');
  const finalVersion = Number(bridge.query('SELECT row_version FROM gib.sessions WHERE id = $1', [rowSessionId])[0].row_version);
  assert.ok(finalVersion > beforeVersion, 'успешный ответ повышает row_version');
}

run().catch((e) => { console.error(e); process.exit(1); });
`,
    );

    const runResult = spawnSync(
      path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
      [childScript],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          GIB_STORE: 'postgres',
          GIB_PG_DIR: path.join(tmp, 'pgdata'),
          TELEGRAM_BOT_TOKEN: tgToken,
          TELEGRAM_WEBHOOK_SECRET: 'tg-secret-test-123456',
          MAX_WEBHOOK_SECRET: 'max-secret-test-123456',
          GIB_SESSION_SECRET: 'session-secret-test-0123456789abcdef',
          GIB_ADMIN_TOKEN: 'admin-secret-token-1234567890',
        },
        encoding: 'utf8',
      },
    );
    if (runResult.status !== 0) {
      console.error(runResult.stdout);
      console.error(runResult.stderr);
    }
    assert.equal(runResult.status, 0, 'интеграционный прогон на PostgreSQL завершился успешно');
    console.log('  ok PostgreSQL: группы, отметки педагога, удаление платного профиля + payment_ledger, возвраты, PIN-кука, веб-вход, рассылка отчётов и построчный асинхронный писатель (версии строк, последовательности, откат при конфликте)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- 4. Проверка DevOps и мониторинг-артефактов ---- */
  for (const file of [
    'Dockerfile',
    'docker-compose.yml',
    '.env.example',
    '.github/workflows/ci.yml',
    'ops/alertmanager/alertmanager.yml',
    'ops/grafana/provisioning/datasources/prometheus.yml',
    'ops/grafana/provisioning/dashboards/dashboards.yml',
  ]) {
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `${file} присутствует`);
  }
  const composeText = fs.readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8');
  for (const svc of ['postgres-backup:', 'prometheus:', 'alertmanager:', 'grafana:']) {
    assert.ok(composeText.includes(svc), `docker-compose.yml описывает сервис ${svc}`);
  }
  console.log('  ok DevOps: Dockerfile, docker-compose (postgres-backup + monitoring stack), .env.example и CI на месте');

  /* ---- 5. v2+ · Journey: у всех 60 дней выбор из трёх историй, непрочитанные поднимаются наверх ---- */
  assert.equal(JOURNEY_STORY_CARDS.length, 120, 'в Journey-колоде 120 карточек (79 базовых + 41 третья карточка недели)');
  const auditBands = ['5-7', '8-10', '11-13'] as const;
  for (let day = 0; day < 60; day++) {
    for (const band of auditBands) {
      const offer = selectStoryCards(day, band, [], `audit-deck-${day}`, JOURNEY_STORY_CARDS);
      assert.equal(offer.length, 3, `день ${day + 1} (${band}) предлагает три истории`);
      assert.equal(new Set(offer.map((choice) => choice.scenarioId)).size, 3, `день ${day + 1} (${band}): три разные истории`);
    }
  }
  // Ранее не пройденная карточка поднимается наверх при том же сиде (seenStories из сохранённой сессии).
  const rotationSeed = 'audit-rotation-seed';
  const baseline = selectStoryCards(0, '8-10', [], rotationSeed, JOURNEY_STORY_CARDS);
  const seenTopCard = baseline[0].id;
  const rotated = selectStoryCards(0, '8-10', [seenTopCard], rotationSeed, JOURNEY_STORY_CARDS);
  assert.equal(rotated.length, 3, 'после отметки «пройдено» предложение остаётся из трёх карточек');
  assert.equal(rotated[rotated.length - 1].id, seenTopCard, 'пройденная карточка уходит вниз колоды');
  assert.notEqual(rotated[0].id, seenTopCard, 'наверх поднимается ещё не пройденная история');
  console.log('  ok Journey: 60 дней × 3 возраста предлагают три истории, непрочитанные поднимаются по seenStories');

  /* ---- 6. v2+ · Звук и PWA: явная подпись «Без звука», единый mute, статический service worker ---- */
  const hudData = { level: 4, levelTitle: 'Искра', xp: 130, xpPercent: 56, coins: 80, stars: 11 };
  setMuted(false);
  const hudSoundOn = renderToStaticMarkup(<Hud data={hudData} />);
  assert.ok(hudSoundOn.includes('hud-sound'), 'Hud рендерит кнопку звука');
  assert.ok(hudSoundOn.includes('>Звук<'), 'подпись «Звук» видна, когда звук включён');
  const muteEvents: boolean[] = [];
  const unsubscribe = onMuteChange((value) => { muteEvents.push(value); });
  setMuted(true);
  assert.equal(isMuted(), true, 'setMuted(true) включает беззвучный режим');
  unsubscribe();
  const hudMuted = renderToStaticMarkup(<Hud data={hudData} />);
  assert.ok(hudMuted.includes('Без звука'), 'в беззвучном режиме подпись — «Без звука»');
  assert.ok(hudMuted.includes('aria-pressed="true"'), 'кнопка отражает aria-pressed=true');
  setMuted(false);
  assert.deepEqual(muteEvents, [true], 'onMuteChange уведомляет подписчиков об изменении режима');

  const swSource = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
  assert.ok(swSource.includes('gib-static-v2'), 'service worker — статический кеш gib-static-v2');
  assert.ok(/pathname\.startsWith\('\/api\/'\)\)\s*return false/.test(swSource), 'API исключён из кеша');
  assert.ok(swSource.includes('/art/v2/') && swSource.includes('/fonts/'), 'кешируются только неизменяемые ресурсы оформления');
  const manifestSource = fs.readFileSync(path.join(process.cwd(), 'app', 'manifest.ts'), 'utf8');
  assert.ok(manifestSource.includes("display: 'standalone'"), 'PWA-манифест standalone');
  assert.ok(fs.existsSync(path.join(process.cwd(), 'public', 'art', 'v2', 'creatures', 'lis-face.png')), 'иконка манифеста существует в public/');
  const layoutSource = fs.readFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
  assert.ok(layoutSource.includes("manifest: '/manifest.webmanifest'") && layoutSource.includes('<PwaRegistration />'), 'layout отдаёт манифест и регистрирует SW');
  const pwaSource = fs.readFileSync(path.join(process.cwd(), 'components', 'PwaRegistration.tsx'), 'utf8');
  assert.ok(pwaSource.includes("serviceWorker.register('/sw.js'"), 'SW регистрируется по /sw.js');
  const readAloudSource = fs.readFileSync(path.join(process.cwd(), 'components', 'ReadAloud.tsx'), 'utf8');
  assert.ok(readAloudSource.includes('onMuteChange'), 'ReadAloud синхронизируется с общим режимом «Без звука»');
  console.log('  ok Звук и PWA: явный режим «Без звука», onMuteChange для Hud/ReadAloud, standalone-манифест и статический SW без API');

  /* ---- 7. v2+ · FQS: 15 пунктов, α Кронбаха, парная дельта, экспорт и удаление с отзывом согласия ---- */
  const fqsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-fqs-'));
  const prevFqsFile = process.env.GIB_FQS_FILE;
  process.env.GIB_FQS_FILE = path.join(fqsTmp, 'research-fqs.json');
  try {
    const allFours = Object.fromEntries(FQS_ITEMS.map((item) => [item.id, 4]));
    const scored = parseAndScoreFqsItems(allFours);
    assert.ok(scored.ok, 'корректный бланк принимается');
    if (!scored.ok) throw new Error('parse_failed');
    assert.equal(FQS_ITEMS.length, 15, 'в опроснике 15 пунктов');
    for (const dimension of FQS_DIMENSIONS) {
      assert.equal(scored.subscales[dimension.id], 4, `шкала ${dimension.id} считается как среднее`);
    }
    // Неконфликтных пунктов 12, конфликтных 3: (4*12 + (6-4)*3) / 15 = 3.6
    assert.equal(scored.compositeMean, 3.6, 'шкала конфликта инвертируется в составном среднем');
    assert.equal(parseAndScoreFqsItems({ ...allFours, [FQS_ITEMS[0].id]: 6 }).ok, false, 'балл вне шкалы 1–5 отклоняется');

    assert.equal(computeCronbachAlpha([[5, 5, 5], [1, 1, 1], [4, 4, 4], [2, 2, 2]]), 1, 'согласованные пункты дают α = 1');
    assert.equal(computeCronbachAlpha([[3, 3], [3, 3], [3, 3]]), null, 'нулевая дисперсия → α = null');
    assert.equal(computeCronbachAlpha([[5, 1], [1, 5]]), null, 'меньше трёх наблюдений → α = null');

    const mkFqs = (participantHash: string, stage: 'entry' | 'final', score: number, createdAt: number): FqsResponseRecord => {
      const raw = Object.fromEntries(FQS_ITEMS.map((item) => [item.id, score]));
      const parsed = parseAndScoreFqsItems(raw);
      if (!parsed.ok) throw new Error('parse_failed');
      return {
        responseId: `fqs_${participantHash}_${stage}`,
        profileId: `p_fqs_${participantHash}`,
        participantHash,
        ageBand: '8-10',
        stage,
        lesson: 1,
        items: parsed.items,
        subscales: parsed.subscales,
        compositeMean: parsed.compositeMean,
        createdAt,
      };
    };
    saveFqsResponse(mkFqs('hash_a', 'entry', 3, 1000));
    saveFqsResponse(mkFqs('hash_a', 'final', 5, 2000));
    saveFqsResponse(mkFqs('hash_b', 'entry', 3, 1000));
    saveFqsResponse(mkFqs('hash_b', 'final', 5, 2000));
    const fqsSummary = summarizeFqsResponses(listFqsResponses());
    assert.equal(fqsSummary.totalResponses, 4);
    assert.equal(fqsSummary.uniqueParticipants, 2);
    assert.equal(fqsSummary.byStage.entry.count, 2);
    assert.equal(fqsSummary.byStage.final.count, 2);
    assert.equal(fqsSummary.pairedEntryToFinal.participantsCount, 2, 'дельта считается по парным участникам');
    // composite(3) = (3*12 + 3*3) / 15 = 3.0; composite(5) = (5*12 + 1*3) / 15 = 4.2; Δ = 1.2
    assert.equal(fqsSummary.pairedEntryToFinal.deltaCompositeMean, 1.2, 'парная дельта final − entry посчитана верно');

    const emptyAnalytics = { profiles: [], sessions: [], subs: [], programStates: [], payments: [], groups: [], memberships: [], ledgerCount: 0 };
    const fqsEnv = { ...process.env, GIB_SESSION_SECRET: 'audit-fqs-secret' };
    const fqsBuilt = buildDatasetRows('fqs', emptyAnalytics, fqsEnv);
    const fqsCsv = rowsToCsv(fqsBuilt.columns, fqsBuilt.rows);
    assert.ok(fqsCsv.startsWith('response_id,participant_hash,'), 'FQS-экспорт — CSV с псевдонимом участника');
    assert.ok(!fqsCsv.includes('p_fqs_hash_a'), 'экспорт не содержит сырого profileId');
    const fqsStatements = buildXapiStatements('fqs', emptyAnalytics, fqsEnv);
    assert.equal(fqsStatements.length, 4, 'xAPI: по одному утверждению на бланк');
    assert.equal(fqsStatements[0].version, '1.0.3');
    assert.ok(JSON.stringify(fqsStatements).includes('/activities/fqs/'), 'xAPI-объекты указывают на активность fqs');

    const purged = purgeProfileFqsLinks('p_fqs_hash_a');
    assert.equal(purged, 2, 'отзыв согласия удаляет все бланки профиля');
    assert.equal(listFqsResponses().some((row) => row.profileId === 'p_fqs_hash_a'), false, 'после удаления бланков профиля нет');
    assert.equal(listFqsResponses().length, 2, 'бланки второго участника не затронуты');
    console.log('  ok FQS: шкалы и составное среднее с инверсией конфликта, α Кронбаха, парная дельта, экспорт CSV/xAPI и удаление с отзывом согласия');
  } finally {
    if (prevFqsFile === undefined) delete process.env.GIB_FQS_FILE; else process.env.GIB_FQS_FILE = prevFqsFile;
    fs.rmSync(fqsTmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
