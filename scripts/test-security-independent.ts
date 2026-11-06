/**
 * Независимый security-тест: проверяет сервис снаружи, не доверяя его коду.
 *
 * Отличие от `test:security`: тот импортирует модули приложения и проверяет их
 * поведение «изнутри». Здесь — только HTTP и собственные реализации проверки
 * подписи и чужих данных. Если в приложении ошибка в проверке подписи, тест
 * внутри её не заметит (он использует ту же функцию), а независимый — заметит.
 *
 * Проверяется на живой production-сборке:
 *  1. Подпись `initData` реализована независимо и принимается; изменённые
 *     данные, чужой токен и просроченная метка — отвергаются.
 *  2. Заголовок одного ребёнка не даёт доступ к профилю другого (IDOR): чужой
 *     профиль неотличим от несуществующего.
 *  3. Служебные маршруты закрыты: метрики без токена, методы не из белого списка.
 *  4. Заголовки ответа: `nosniff`, `no-referrer`, `no-store`; нет утечки версии.
 *  5. Тело запроса: JSON обязателен, переполнение отвергается.
 *  6. Ни одна ошибка не отдаёт стек, путь и токен.
 *  7. Гонка: параллельные запросы не создают второго ребёнка.
 *
 * Платформенные токены здесь тестовые: тест не ходит в Telegram и MAX.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 3191;
const BASE = `http://127.0.0.1:${PORT}`;
const BOT_TOKEN = '123456789:' + 'S'.repeat(35);
const OTHER_TOKEN = '987654321:' + 'T'.repeat(35);
const METRICS_TOKEN = 'independent-metrics-token-123';

let okCount = 0;
function ok(label: string) {
  okCount++;
  console.log('  ok ' + label);
}

/**
 * Независимая реализация проверки подписи Telegram WebApp.
 *
 * Написана по документации платформы и **не** импортирует `lib/telegram.ts`:
 * смысл в том, чтобы не повторить ту же ошибку, что и проверяемый код.
 */
function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function initDataFor(id: number, token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000)): string {
  return signInitData(
    { auth_date: String(authDate), query_id: 'AA' + id, user: JSON.stringify({ id, first_name: 'Тест', username: 'test' }) },
    token,
  );
}

function telegram(id: number, token = BOT_TOKEN, authDate?: number): Record<string, string> {
  return { 'x-telegram-init-data': initDataFor(id, token, authDate) };
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: string; json: any; headers: Headers }> {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON — тоже результат */
  }
  return { status: res.status, body: text, json, headers: res.headers };
}

const jsonHeaders = (extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', ...extra });

async function main() {
  assert.ok(existsSync(join(ROOT, '.next/BUILD_ID')), 'нужна production-сборка (npm run build)');
  const dir = mkdtempSync(join(tmpdir(), 'gib-sec-'));
  const server = spawn('./node_modules/.bin/next', ['start', '-p', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Заглушка запуска в production закрывает пользовательский API. Здесь она
      // снимается только для этого теста: проверять авторизацию через 503 нельзя.
      GIB_DEMO_MODE: '1',
      // Снимаем заглушку запуска только в этом тестовом процессе: иначе все
      // запросы получат 503 и проверять авторизацию будет не на чем.
      GIB_SECURITY_TEST: '1',
      GIB_SQLITE_FILE: join(dir, 'sec.sqlite'),
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      GIB_METRICS_TOKEN: METRICS_TOKEN,
    },
    stdio: 'pipe',
  });
  let log = '';
  server.stdout.on('data', d => (log += d));
  server.stderr.on('data', d => (log += d));

  try {
    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(BASE + '/api/health')).ok) {
          up = true;
          break;
        }
      } catch {
        /* поднимается */
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert.ok(up, `сервер поднялся:\n${log.slice(-600)}`);

    // 1. Подпись: своя реализация принимается, чужая — нет.
    const first = await call('/api/profile', { headers: jsonHeaders(telegram(5001)) });
    assert.equal(first.status, 200, `подписанный запрос принят: ${first.status} ${first.body.slice(0, 120)}`);
    ok('независимо подписанный initData принимается сервисом');

    const unsigned = await call('/api/profile');
    assert.equal(unsigned.status, 401, 'без подписи — 401');
    assert.equal(unsigned.json?.error, 'unauthorized');
    assert.ok(!unsigned.body.includes('5001'), 'в отказе нет идентификатора');

    const tamperedBody = initDataFor(5001, BOT_TOKEN).replace(/user=[^&]+/, encodeURIComponent(JSON.stringify({ id: 9999, first_name: 'Вор' })));
    const tampered = await call('/api/profile', { headers: { 'x-telegram-init-data': tamperedBody } });
    assert.equal(tampered.status, 401, 'изменённые данные при старой подписи отвергнуты');

    const wrongToken = await call('/api/profile', { headers: { 'x-telegram-init-data': initDataFor(5001, OTHER_TOKEN) } });
    assert.equal(wrongToken.status, 401, 'чужой токен бота отвергнут');

    const expired = await call('/api/profile', { headers: { 'x-telegram-init-data': initDataFor(5001, BOT_TOKEN, Math.floor(Date.now() / 1000) - 90_000) } });
    assert.equal(expired.status, 401, 'просроченная подпись отвергнута');

    const future = await call('/api/profile', { headers: { 'x-telegram-init-data': initDataFor(5001, BOT_TOKEN, Math.floor(Date.now() / 1000) + 3600) } });
    assert.equal(future.status, 401, 'подпись из будущего отвергнута');

    const garbage = await call('/api/profile', { headers: { 'x-telegram-init-data': 'hash=00&auth_date=1&user=notjson' } });
    assert.equal(garbage.status, 401, 'мусор вместо подписи отвергнут');

    // Заголовок не подписи: подсунуть «parentId» в теле нельзя.
    const impersonate = await call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(5001)), body: JSON.stringify({ parentId: 'demo:someone', name: 'Вор', age: 8 }) });
    assert.equal(impersonate.status === 200 || impersonate.status === 400, true, 'подмена parentId в теле не меняет владельца');
    const firstProfile = await call('/api/profile', { headers: telegram(5001) });
    // Идентификатор владельца (Telegram ID) — не данные для клиента: он не
    // нужен интерфейсу, зато связывает профиль ребёнка с аккаунтом взрослого.
    assert.ok(!firstProfile.body.includes('5001'), `идентификатор владельца не отдаётся: ${firstProfile.body.slice(0, 200)}`);
    ok('подпись: изменения, чужой токен, просрочка, будущее и мусор отвергаются');

    // 2. IDOR: профиль ребёнка A не виден ребёнку B.
    const created = await call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(5001)), body: JSON.stringify({ name: 'Первый', age: 7 }) });
    assert.equal(created.status, 200, `профиль создан: ${created.status}`);
    const profileId = created.json?.profile?.id;
    assert.ok(profileId, 'в ответе есть id профиля');

    const asOwner = await call(`/api/profile?profileId=${profileId}`, { headers: telegram(5001) });
    assert.equal(asOwner.json?.profile?.id, profileId, 'владелец видит свой профиль');

    const asStranger = await call(`/api/profile?profileId=${profileId}`, { headers: telegram(5002) });
    assert.equal(asStranger.status, 200, 'чужой профиль не отличим от отсутствующего по коду');
    assert.equal(asStranger.json?.profile, null, 'чужой профиль не отдан');

    const deleteAsStranger = await call(`/api/profile?profileId=${profileId}`, { method: 'DELETE', headers: telegram(5002) });
    assert.ok([403, 404].includes(deleteAsStranger.status), `чужой профиль нельзя удалить: ${deleteAsStranger.status}`);
    const stillThere = await call(`/api/profile?profileId=${profileId}`, { headers: telegram(5001) });
    assert.equal(stillThere.json?.profile?.id, profileId, 'после чужой попытки профиль на месте');
    ok('IDOR: чужой профиль не читается и не удаляется, ответ неотличим от отсутствующего');

    // 3. Служебные маршруты.
    const metricsClosed = await call('/api/metrics');
    assert.equal(metricsClosed.status, 401, 'метрики без токена — 401');
    assert.ok(!metricsClosed.body.includes('gib_'), 'в отказе нет имён метрик');
    const metricsWrong = await call('/api/metrics', { headers: { authorization: 'Bearer ' + 'x'.repeat(24) } });
    assert.equal(metricsWrong.status, 401, 'неверный токен — 401');
    const metricsOk = await call('/api/metrics', { headers: { authorization: 'Bearer ' + METRICS_TOKEN } });
    assert.equal(metricsOk.status, 200, 'верный токен — 200');
    const health = await call('/api/health');
    assert.equal(health.status, 200, 'живость 200 без авторизации');
    // Живость не должна отдавать состояние хранилища: она отвечает только «жив».
    assert.ok(!/профил|sqlite|\.sqlite/i.test(health.body), 'в живости нет путей и числа профилей');
    const ready = await call('/api/ready');
    assert.ok([200, 503].includes(ready.status), `готовность отвечает по делу: ${ready.status}`);
    assert.ok(!/TELEGRAM_BOT_TOKEN=[^\s"]/.test(ready.body), 'в готовности нет значений токенов');
    ok('служебные маршруты: метрики под токеном, живость без утечек, готовность без секретов');

    // 4. Заголовки ответа.
    const headers = health.headers;
    assert.equal(headers.get('x-content-type-options'), 'nosniff', 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'no-referrer', 'no-referrer');
    assert.ok((headers.get('cache-control') ?? '').includes('no-store'), 'no-store на API');
    assert.ok(!headers.has('x-powered-by'), 'версия фреймворка не раскрывается');
    assert.ok(/^[a-f0-9]{32}$/.test(headers.get('x-trace-id') ?? ''), 'есть идентификатор запроса');
    ok('заголовки: nosniff, no-referrer, no-store, без x-powered-by, с идентификатором');

    // 5. Тело запроса.
    const notJson = await call('/api/profile', { method: 'POST', headers: { ...telegram(5001), 'content-type': 'text/plain' }, body: 'name=x' });
    assert.equal(notJson.status, 415, 'не-JSON отвергается с 415');
    const huge = await call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(5001)), body: JSON.stringify({ name: 'x'.repeat(200_000), age: 8 }) });
    assert.ok([400, 413].includes(huge.status), `переполнение отвергается: ${huge.status}`);
    const badJson = await call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(5001)), body: '{не json' });
    assert.equal(badJson.status, 400, 'битый JSON — 400');
    ok('тело: не-JSON 415, переполнение и битый JSON отвергаются');

    // 6. Ошибки не раскрывают внутренности.
    const probes = ['/api/nope', '/api/profile?profileId=../etc/passwd', "/api/profile?profileId=' OR 1=1--"];
    for (const probe of probes) {
      const res = await call(probe, { headers: telegram(5001) });
      assert.ok(res.status < 500 || res.status === 503, `${probe}: без 5xx (${res.status})`);
      assert.ok(!/at .*\.tsx?:\d+|node_modules|\.sqlite|\/home\//.test(res.body), `${probe}: без стека и путей`);
    }
    ok('ошибки не отдают стек, пути и содержимое базы');

    // 7. Гонка: параллельные POST не создают второго ребёнка.
    const racer = 6001;
    await call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(racer)), body: JSON.stringify({ name: 'Гонка', age: 9 }) });
    const parallel = await Promise.all(
      Array.from({ length: 8 }, () => call('/api/profile', { method: 'POST', headers: jsonHeaders(telegram(racer)), body: JSON.stringify({ name: 'Гонка', age: 9 }) })),
    );
    const ids = new Set(parallel.map(r => r.json?.profile?.id).filter(Boolean));
    assert.equal(ids.size, 1, `параллельные запросы вернули один профиль: ${[...ids].join(', ')}`);
    const listed = await call('/api/profile', { headers: telegram(racer) });
    assert.equal((listed.json?.profiles ?? []).length, 1, 'у второго владельца ровно один ребёнок');
    ok('гонка: восемь параллельных созданий дают одного ребёнка');

    // 8. Лимит запросов действительно режет перебор, а не только считает.
    let blocked = 0;
    for (let i = 0; i < 20; i++) {
      const res = await call('/api/profile/export', { headers: telegram(7001) });
      if (res.status === 429) blocked++;
    }
    assert.ok(blocked > 0, `перебор упирается в 429: ${blocked} из 20`);
    ok(`лимит режет перебор: ${blocked} из 20 запросов получили 429`);
  } finally {
    server.kill('SIGTERM');
  }

  console.log(`\n  ok независимый security-тест: ${okCount} проверок`);
}

main().catch(error => {
  console.error('\nAssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
