/**
 * Production: заглушка запуска не должна скрывать служебные маршруты,
 * но обязана по-прежнему закрывать пользовательский API.
 * BASE=http://127.0.0.1:<port production> npx tsx scripts/test-observability-prod.ts
 */
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://localhost:3001';

async function main() {
  // 1. Живость и готовность доступны дежурному в production.
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200, 'живость открыта в production');
  const healthJson = await health.json();
  assert.equal(healthJson.alive, true);

  const ready = await fetch(base + '/api/ready');
  const readyJson = await ready.json();
  assert.ok([200, 503].includes(ready.status), `готовность отвечает 200 или 503, получили ${ready.status}`);
  assert.ok(['ready', 'degraded', 'not_ready'].includes(readyJson.status));
  assert.equal(readyJson.environment, 'production', 'окружение названо production');
  console.log(`  ok в production служебные маршруты открыты: живость 200, готовность ${ready.status}`);

  // 2. Пользовательский API по-прежнему закрыт заглушкой.
  for (const path of ['/api/session?profileId=p', '/api/profile', '/api/report?profileId=p']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 503, `${path} закрыт в production`);
    const json = await res.json();
    assert.equal(json.error, 'production_not_ready');
  }
  console.log('  ok пользовательский API закрыт заглушкой 503');

  // 3. Метрики закрыты без токена даже в production.
  const metrics = await fetch(base + '/api/metrics');
  assert.equal(metrics.status, 401, 'метрики без токена закрыты в production');
  const metricsJson = await metrics.json();
  assert.equal(metricsJson.error, 'metrics_unauthorized');
  assert.ok(!JSON.stringify(metricsJson).includes('gib_http'), 'имена метрик не раскрыты');
  console.log('  ok метрики в production закрыты без токена');

  // 4. Заглушка не отдаёт данные ребёнка и не врёт про готовность.
  const body = await (await fetch(base + '/api/session?profileId=p')).text();
  assert.ok(!/initData|profileId":"p_/.test(body), 'в отказе нет данных запроса');
  console.log('  ok отказ не раскрывает данные запроса');

  console.log('  ok production: служебные маршруты открыты, пользовательский API закрыт');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
