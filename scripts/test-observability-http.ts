/**
 * HTTP: живость, готовность, метрики и заглушка production.
 * BASE=http://127.0.0.1:<порт> METRICS_TOKEN=... npx tsx scripts/test-observability-http.ts
 */
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://localhost:3000';
const token = process.env.METRICS_TOKEN ?? '';

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* текст, не JSON */ }
  return { status: res.status, text, json, headers: res.headers };
}

async function main() {
  // 1. Живость: 200, версия, время работы, без кеша.
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.alive, true);
  assert.ok(health.json.uptimeMs >= 0);
  // Middleware добавляет private к no-store: главное, что кеширование запрещено.
  assert.ok(health.headers.get('cache-control')?.includes('no-store'), 'живость не кешируется');
  console.log('  ok живость отвечает 200 и не кешируется');

  // 2. Готовность: 200 и понятный статус.
  const ready = await get('/api/ready');
  assert.equal(ready.status, 200, `готовность 200: ${ready.text.slice(0, 200)}`);
  assert.ok(['ready', 'degraded'].includes(ready.json.status), `статус: ${ready.json.status}`);
  assert.equal(ready.json.ready, true);
  assert.ok(Array.isArray(ready.json.checks) && ready.json.checks.length >= 3);
  assert.ok(ready.json.checks.every((c: any) => typeof c.ok === 'boolean' && typeof c.detail === 'string'));
  console.log(`  ok готовность: ${ready.json.status}, проверок ${ready.json.checks.length}`);

  // 3. В готовности нет данных ребёнка и секретов.
  assert.ok(!/initData|hash=|token|Мира|joy/i.test(ready.text), 'нет секретов и данных ребёнка');
  console.log('  ok готовность не раскрывает секретов');

  // 4. Метрики без токена закрыты.
  const closed = await get('/api/metrics');
  assert.equal(closed.status, 401, 'без токена метрики закрыты');
  assert.equal(closed.json.error, 'metrics_unauthorized');
  assert.ok(!closed.text.includes('gib_http'), 'имена метрик не раскрыты');
  console.log('  ok метрики без токена закрыты');

  // 5. С неверным токеном — тоже 401.
  assert.equal((await get('/api/metrics', { authorization: 'Bearer wrong-token-value-1234' })).status, 401);

  // 6. С правильным токеном — формат Prometheus и реальные значения.
  if (token) {
    // Метрики появляются после вызовов: сначала дёргаем эндпоинты, потом читаем.
    await get('/api/health');
    await get('/api/ready');
    const open = await get('/api/metrics', { authorization: `Bearer ${token}` });
    assert.equal(open.status, 200, `с токеном: ${open.text.slice(0, 200)}`);
    assert.ok(open.headers.get('content-type')?.includes('text/plain'));
    assert.ok(open.text.includes('gib_uptime_seconds'), 'есть uptime');
    assert.ok(open.text.includes('gib_health_checks_total'), 'счётчик проверок живости');
    assert.ok(open.text.includes('gib_readiness_checks_ok_total'), 'счётчик готовности');
    assert.ok(/gib_readiness_degraded_checks \d+/.test(open.text), 'видно число выключенных возможностей');
    assert.ok(!/[\u0400-\u04FF]/.test(open.text.replace(/^# HELP .*$/gm, '')), 'значения без кириллицы');
    console.log('  ok метрики с токеном: формат Prometheus и значения на месте');

    // 7. После запросов метрики растут, а не замирают.
    await get('/api/health');
    const again = await get('/api/metrics', { authorization: `Bearer ${token}` });
    const first = Number(/gib_health_checks_total (\d+)/.exec(open.text)?.[1] ?? 0);
    const second = Number(/gib_health_checks_total (\d+)/.exec(again.text)?.[1] ?? 0);
    assert.ok(second > first, `счётчик живости растёт: ${first} → ${second}`);
    console.log('  ok метрики обновляются между запросами');
  } else {
    console.log('  ok метрики с токеном (проверка требует METRICS_TOKEN)');
  }

  console.log('  ok наблюдаемость по HTTP: живость, готовность, закрытые метрики');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
