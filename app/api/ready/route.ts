import { NextResponse } from 'next/server';
import { readiness } from '@/lib/observability/readiness';
import { metrics } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

/**
 * Готовность принимать запросы.
 *
 * 200 — можно работать (возможно, часть необязательных возможностей выключена,
 *       это видно по `status: "degraded"`);
 * 503 — работать нельзя: состояние или хранилище недоступны.
 *
 * Ответ 503 нужен для балансировщика, но не должен приводить к перезапуску
 * контейнера: для этого есть /api/health.
 */
export async function GET() {
  const report = readiness();
  metrics.inc(report.ready ? 'readiness_checks_ok_total' : 'readiness_checks_failed_total');
  metrics.set('readiness_degraded_checks', report.checks.filter(c => c.level === 'degraded' && !c.ok).length);
  for (const check of report.checks) {
    if (check.level === 'ready') {
      metrics.inc(check.ok ? `check_${check.id}_ok_total` : `check_${check.id}_failed_total`);
    }
  }
  return NextResponse.json(report, {
    status: report.ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
