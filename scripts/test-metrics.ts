/**
 * Метрики: счётчики, показатели, гистограмма, экспорт в Prometheus, границы.
 */
import assert from 'node:assert/strict';
import { Metrics, histogramSummary, toPrometheus, LATENCY_BUCKETS_MS } from '../lib/observability/metrics';

const m = new Metrics();

// 1. Счётчики только растут и складываются.
m.inc('requests_total');
m.inc('requests_total', 4);
m.inc('requests_total', 0);
m.inc('requests_total', -3);
assert.equal(m.snapshot().counters.requests_total, 5, 'нулевые и отрицательные не считаются');

// 2. Показатель заменяется, а не складывается.
m.set('queue_depth', 3);
m.set('queue_depth', 1);
assert.equal(m.snapshot().gauges.queue_depth, 1, 'показатель — последнее значение');
m.set('queue_depth', Number.NaN);
assert.equal(m.snapshot().gauges.queue_depth, 1, 'мусор не портит показатель');

// 3. Гистограмма попадает в корзины.
m.observe('latency', 3);
m.observe('latency', 30);
m.observe('latency', 700);
const h = m.snapshot().histograms.latency;
assert.equal(h.count, 3);
assert.equal(h.buckets[0], 1, '3 мс — первая корзина');
assert.equal(h.buckets[2], 1, '30 мс — 50-я корзина');
assert.equal(h.buckets[6], 1, '700 мс — корзина 1000 (индекс 6)');
assert.equal(h.maxMs, 700);
assert.equal(Math.round(h.sumMs), 733);

// 4. Значения сверх последней корзины не теряются.
m.observe('latency', 60_000);
const h2 = m.snapshot().histograms.latency;
assert.equal(h2.overflow, 1, 'медленнее 10 с — в overflow');
assert.equal(h2.count, 4, 'счётчик наблюдений честный');
assert.equal(h2.maxMs, 60_000);

// 5. Мусорные значения не учитываются.
m.observe('latency', -5);
m.observe('latency', Number.POSITIVE_INFINITY);
assert.equal(m.snapshot().histograms.latency.count, 4, 'отрицательное и бесконечность отброшены');

// 6. Сводка по гистограмме читается человеком.
const summary = histogramSummary(h2);
assert.equal(summary.count, 4);
assert.ok(summary.avgMs > 0);
assert.equal(summary.maxMs, 60_000);
console.log('  ok счётчики, показатели, корзины и мусор');

// 7. Экспорт Prometheus: имена безопасны, типы и корзины на месте.
const text = toPrometheus(new Metrics() && m.snapshot(), 'gib');
assert.ok(text.includes('gib_uptime_seconds'), 'есть uptime');
assert.ok(text.includes('# TYPE gib_requests_total counter'));
assert.ok(text.includes('gib_requests_total 5'));
assert.ok(text.includes('# TYPE gib_latency histogram'));
assert.ok(text.includes('gib_latency_bucket{le="0.005"} 1'), 'корзина 5 мс');
assert.ok(text.includes('gib_latency_bucket{le="+Inf"} 4'), 'бесконечная корзина включает overflow (3 корзины + 1 сверх)');
assert.ok(text.includes('gib_latency_count 4'));
assert.ok(text.includes('gib_latency_sum'), 'сумма в секундах');
assert.ok(!/[\u0400-\u04FF]/.test(text.replace(/^# HELP .*$/gm, '')), 'в значениях нет кириллицы');
assert.ok(text.endsWith('\n'), 'файл заканчивается переводом строки');
console.log('  ok экспорт Prometheus');

// 8. Имя с недопустимыми символами нормализуется, а не ломает формат.
const weird = new Metrics();
weird.inc('http:route-with.dots');
const weirdText = toPrometheus(weird.snapshot());
assert.ok(weirdText.includes('gib_http:route_with_dots 1'), 'имя приведено к допустимому');
console.log('  ok недопустимые имена нормализуются');

// 9. Границы числа меток: переполнение не съедает память.
const many = new Metrics();
for (let i = 0; i < 700; i++) many.inc(`metric_${i}_total`);
const snap = many.snapshot();
const total = Object.keys(snap.counters).length;
assert.ok(total <= 501, `меток не больше лимита, получилось ${total}`);
assert.ok(snap.counters.metrics_dropped_total > 0, 'отказы записаны явно');
console.log('  ok кардинальность ограничена, отказы видны');

// 10. Корзины монотонны — иначе гистограмма врёт.
for (let i = 1; i < LATENCY_BUCKETS_MS.length; i++) assert.ok(LATENCY_BUCKETS_MS[i] > LATENCY_BUCKETS_MS[i - 1], 'корзины возрастают');

// 11. Сброс нужен тестам и не ломает реестр.
m.reset();
assert.deepEqual(m.snapshot().counters, {});
assert.deepEqual(m.snapshot().histograms, {});
console.log('  ok сброс реестра');

console.log('  ok метрики: счётчики, показатели, гистограмма, Prometheus, границы');
