/**
 * Готовность: живость не зависит от базы, готовность — зависит,
 * необязательные возможности дают degraded, а не отказ.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shouldBlockPath, isOpsPath, OPS_PATHS } from '../lib/launch-guard';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-ready-'));
process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = path.join(dir, 'ready.sqlite');

async function main() {
  const { readiness, liveness, buildVersion } = await import('../lib/observability/readiness');

  // 1. Живость: отвечает и не трогает базу.
  const live = liveness();
  assert.equal(live.alive, true);
  assert.ok(live.uptimeMs >= 0);
  assert.match(live.version, /^[0-9a-zA-Z._-]{1,40}$/, 'версия безопасна для вывода');
  console.log('  ok живость отвечает без обращения к базе');

  // 2. Готовность: обязательные проверки проходят.
  const report = readiness();
  // Оплата и бот в тестовом окружении не настроены, поэтому честный статус —
  // degraded: сервис работает, необязательные возможности выключены.
  assert.equal(report.status, 'degraded', `статус degraded: ${JSON.stringify(report.checks)}`);
  assert.equal(report.ready, true, 'принимать запросы можно');
  assert.equal(report.ok, true, 'обязательные проверки пройдены');
  const ids = report.checks.map(c => c.id).sort();
  assert.deepEqual(ids, ['billing', 'notifications', 'state', 'storage', 'store'], 'все проверки на месте');
  const required = report.checks.filter(c => c.level === 'ready');
  assert.equal(required.length, 3, 'обязательных проверок три');
  assert.ok(required.every(c => c.ok && typeof c.durationMs === 'number'), 'обязательные с замером времени');
  console.log('  ok готовность: обязательные проверки проходят, есть замер времени');

  // 3. Необязательные возможности выключены — это degraded, а не отказ.
  const billing = report.checks.find(c => c.id === 'billing')!;
  const notifications = report.checks.find(c => c.id === 'notifications')!;
  assert.equal(billing.ok, false, 'без ключей оплата выключена');
  assert.equal(billing.level, 'degraded', 'оплата не делает сервис нерабочим');
  assert.ok(billing.detail.includes('оплата выключена'), 'причина названа');
  assert.equal(notifications.level, 'degraded');
  console.log('  ok выключенные платёж и бот дают degraded, а не отказ');

  // 4. Версия из окружения принимается только в безопасном виде.
  process.env.GIB_VERSION = 'v1.2.3-rc1';
  assert.equal(buildVersion(), 'v1.2.3-rc1');
  process.env.GIB_VERSION = '<script>alert(1)</script>';
  assert.equal(buildVersion(), 'dev', 'подозрительная версия не выводится как есть');
  process.env.GIB_VERSION = 'x'.repeat(80);
  assert.equal(buildVersion(), 'dev', 'слишком длинная версия отклонена');
  delete process.env.GIB_VERSION;

  // 5. Пропала база — готовность падает, живость остаётся.
  fs.rmSync(path.join(dir, 'ready.sqlite'), { force: true });
  // Адаптер уже держит состояние в памяти, поэтому подменяем путь и читаем заново.
  process.env.GIB_SQLITE_FILE = path.join(dir, 'missing-dir', 'absent.sqlite');
  const broken = readiness();
  assert.equal(broken.ready, false, 'без файла базы сервис не готов');
  assert.equal(broken.status, 'not_ready');
  const storage = broken.checks.find(c => c.id === 'storage')!;
  assert.equal(storage.ok, false, 'проверка файла честно падает');
  assert.ok(storage.detail.includes('файл хранилища недоступен'), 'причина названа');
  assert.equal(liveness().alive, true, 'живость при этом не страдает');
  console.log('  ok пропажа базы: готовность not_ready, живость жива');

  // 6. Служебные пути открыты даже при заблокированном production API.
  assert.ok(OPS_PATHS.length >= 3, 'служебные пути объявлены');
  for (const p of ['/api/health', '/api/ready', '/api/metrics']) {
    assert.equal(isOpsPath(p), true, `${p} служебный`);
    assert.equal(shouldBlockPath(p, 'production'), false, `${p} не закрывается заглушкой`);
  }
  assert.equal(shouldBlockPath('/api/session', 'production'), true, 'пользовательский API закрыт');
  assert.equal(shouldBlockPath('/api/session', 'development'), false, 'в демо не закрыт');
  assert.equal(shouldBlockPath('/api/health/extra', 'production'), true, 'похожий путь не считается служебным');
  console.log('  ok служебные маршруты открыты, пользовательский API закрыт');

  // 7. Отчёт готовности не содержит данных ребёнка.
  const text = JSON.stringify(report);
  assert.ok(!/Мира|joy|initData|token/i.test(text), 'в отчёте нет данных ребёнка и секретов');
  console.log('  ok отчёт готовности без персональных данных');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ok готовность: живость, обязательные проверки, degraded, пропажа базы, служебные пути');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
