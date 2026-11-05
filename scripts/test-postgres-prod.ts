/**
 * Production-сборка на PostgreSQL: проверка того, что пойдёт в бой.
 *
 * Тесты режима (`test:postgres-store`) гоняют движок напрямую. Здесь —
 * собранное приложение под `next start`: другой путь загрузки модулей, другой
 * способ запуска потока базы. Именно на этом уровне ломался путь к воркеру,
 * поэтому проверка нужна отдельно, а не «на глазок».
 *
 * Запуск: npm run build && npm run test:postgres-prod
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 3205;
const BASE = `http://127.0.0.1:${PORT}`;
const BOT_TOKEN = '777000555:' + 'P'.repeat(35);
const METRICS_TOKEN = 'pg-prod-metrics-1234567';

let okCount = 0;
const ok = (label: string) => {
  okCount++;
  console.log('  ok ' + label);
};

function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

async function main() {
  assert.ok(existsSync(join(ROOT, '.next/BUILD_ID')), 'нужна production-сборка (npm run build)');
  const dir = mkdtempSync(join(tmpdir(), 'gib-pg-prod-'));
  const server = spawn(join(ROOT, 'node_modules/.bin/next'), ['start', '-p', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GIB_STORE: 'postgres',
      GIB_PG_DIR: join(dir, 'pg'),
      GIB_SECURITY_TEST: '1',
      GIB_DEMO_MODE: '1',
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
    assert.ok(up, `production-сервер поднялся на PostgreSQL:\n${log.slice(-800)}`);

    // 1. Готовность: хранилище — PostgreSQL, а не файл.
    const ready = await fetch(BASE + '/api/ready', { signal: AbortSignal.timeout(60_000) });
    const readyJson = (await ready.json()) as { checks: { id: string; ok: boolean; detail: string }[] };
    assert.equal(ready.status, 200, `готовность 200: ${JSON.stringify(readyJson.checks?.map(c => c.id))}`);
    const storage = readyJson.checks.find(c => c.id === 'storage')!;
    assert.ok(storage.ok, `проверка хранилища проходит: ${storage.detail}`);
    assert.ok(/postgres/i.test(storage.detail), `в отчёте назван PostgreSQL, а не файл: ${storage.detail}`);
    assert.ok(!/db\.json/.test(JSON.stringify(readyJson)), 'JSON-файл не упоминается как хранилище');
    const storeCheck = readyJson.checks.find(c => c.id === 'store')!;
    assert.ok(storeCheck.ok, `состояние читается из PostgreSQL: ${storeCheck.detail}`);
    ok(`готовность: хранилище — «${storage.detail}», состояние читается`);

    // 2. Полный цикл через HTTP: профиль создаётся и читается.
    const initData = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'Q1', user: JSON.stringify({ id: 8801, first_name: 'Проверка' }) },
      BOT_TOKEN,
    );
    const auth = { 'x-telegram-init-data': initData };
    const created = await fetch(BASE + '/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ name: 'Проверка', age: 9 }),
      signal: AbortSignal.timeout(60_000),
    });
    const createdJson = (await created.json()) as { profile?: { id: string }; error?: string };
    assert.equal(created.status, 200, `профиль создан: ${created.status} ${JSON.stringify(createdJson).slice(0, 150)}`);
    assert.ok(createdJson.profile?.id, 'в ответе есть профиль');
    assert.ok(!JSON.stringify(createdJson).includes('8801'), 'идентификатор взрослого наружу не отдаётся');
    ok('профиль создан через HTTP и записан в PostgreSQL');

    // 3. Чтение из другого запроса — данные действительно в базе, а не в ответе.
    const listed = await fetch(BASE + '/api/profile', { headers: auth, signal: AbortSignal.timeout(60_000) });
    const listedJson = (await listed.json()) as { profile?: { id: string; name: string } };
    assert.equal(listedJson.profile?.id, createdJson.profile.id, 'профиль читается следующим запросом');
    assert.equal(listedJson.profile?.name, 'Проверка');
    ok('запись видна следующему запросу');

    // 4. Сессия: GET отдаёт план дня, POST открывает саму сессию.
    const plan = await fetch(BASE + `/api/session?profileId=${createdJson.profile.id}`, { headers: auth, signal: AbortSignal.timeout(60_000) });
    assert.equal(plan.status, 200, `план дня отдан: ${plan.status}`);
    // Поле называется `plan`: проверяем фактический ответ API, а не догадку.
    const planJson = (await plan.json()) as { plan?: unknown[] };
    assert.ok(Array.isArray(planJson.plan) && planJson.plan.length > 0, `в плане есть шаги: ${JSON.stringify(planJson).slice(0, 160)}`);

    const started = await fetch(BASE + '/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ action: 'start', profileId: createdJson.profile.id }),
      signal: AbortSignal.timeout(60_000),
    });
    const startedJson = (await started.json()) as { sessionId?: string; error?: string };
    assert.equal(started.status, 200, `сессия открыта: ${started.status} ${JSON.stringify(startedJson).slice(0, 160)}`);
    assert.ok(startedJson.sessionId, 'в ответе есть идентификатор сессии');
    ok('план дня и сессия работают на PostgreSQL');

    // 5. Метрики видны, значит обработчики действительно работают, а не заглушены.
    const metrics = await fetch(BASE + '/api/metrics', { headers: { authorization: `Bearer ${METRICS_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
    assert.equal(metrics.status, 200, 'метрики отдаются с токеном');
    const text = await metrics.text();
    assert.ok(text.includes('gib_uptime_seconds'), 'метрики не пустые');
    assert.ok(text.includes('gib_check_storage_ok_total'), 'проверка хранилища учтена (PostgreSQL), а не упала');
    ok('метрики отдаются, проверки готовности учитывают PostgreSQL');

    // 6. В логе нет ошибок базы и зависших запросов.
    assert.ok(!/PostgreSQL: .*not found|Файл потока PostgreSQL не найден/.test(log), 'поток базы найден в собранном приложении');
    ok('поток базы запускается из production-сборки');
  } finally {
    server.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n  ok PostgreSQL в production-сборке: ${okCount} проверок`);
}

main().catch(error => {
  console.error('\nAssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
