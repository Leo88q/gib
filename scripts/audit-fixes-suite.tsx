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
import { paywallCopy } from '../lib/access/entitlement.ts';
import { SHOP } from '../lib/gamification.ts';

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
  /* ---- 1. Проверка разметки Дизайна v2 ---- */
  const crown = SHOP.find((i) => i.variant === 'crown')!;
  const roomHtml = renderToStaticMarkup(
    <Room
      hero="/art/v2/creatures/mira-face.png"
      heroName="Мира"
      pet="cat"
      petLevel={3}
      petMood="happy"
      equippedItems={[{ id: crown.id, name: crown.name, variant: crown.variant, slot: 'head' }]}
    />,
  );
  assert.ok(roomHtml.includes('/art/v2/creatures/pet.png'), 'Room рендерит 3D-питомца v2');
  assert.ok(roomHtml.includes('/art/v2/items/crown.png'), 'Room рендерит надетый 3D-предмет');

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
import { GET as lessonsGet } from '${process.cwd()}/app/api/lessons/route.ts';
import { POST as pinPost, DELETE as pinDelete } from '${process.cwd()}/app/api/parent-pin/route.ts';
import { GET as authGet, POST as authPost } from '${process.cwd()}/app/api/auth/session/route.ts';
import { POST as linkPost } from '${process.cwd()}/app/api/auth/link/route.ts';
import { POST as tgWebhook } from '${process.cwd()}/app/api/telegram/webhook/route.ts';
import { POST as maxWebhook } from '${process.cwd()}/app/api/max/webhook/route.ts';
import { dispatchDueNotifications } from '${process.cwd()}/lib/bots/messenger.ts';

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
        },
        encoding: 'utf8',
      },
    );
    if (runResult.status !== 0) {
      console.error(runResult.stdout);
      console.error(runResult.stderr);
    }
    assert.equal(runResult.status, 0, 'интеграционный прогон на PostgreSQL завершился успешно');
    console.log('  ok PostgreSQL: группы, отметки педагога, удаление платного профиля + payment_ledger, возвраты, PIN-кука, веб-вход и рассылка отчётов');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- 4. Проверка DevOps-артефактов ---- */
  for (const file of ['Dockerfile', 'docker-compose.yml', '.env.example', '.github/workflows/ci.yml']) {
    assert.ok(fs.existsSync(path.join(process.cwd(), file)), `${file} присутствует`);
  }
  console.log('  ok DevOps: Dockerfile, docker-compose.yml, .env.example и GitHub Actions CI на месте');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
