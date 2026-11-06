import { NextResponse } from 'next/server';
import { metrics, toPrometheus } from '@/lib/observability/metrics';
import { readiness } from '@/lib/observability/readiness';

export const dynamic = 'force-dynamic';

/**
 * Метрики в формате Prometheus.
 *
 * Открытые метрики в интернете — это утечка сведений о нагрузке и состоянии.
 * Поэтому формат Prometheus отдаётся только при явно заданном токене
 * (`GIB_METRICS_TOKEN`); без него доступен лишь краткий JSON без цифр нагрузки,
 * и то только в не-production окружении.
 */
export async function GET(req: Request) {
  const token = process.env.GIB_METRICS_TOKEN;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';

  if (token && token === provided && token.length >= 16) {
    metrics.inc('metrics_scrapes_total');
    return new Response(toPrometheus(metrics.snapshot()), {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // Закрытый режим: не отдаём ни чисел нагрузки, ни имён метрик.
  const report = readiness();
  return NextResponse.json(
    {
      error: 'metrics_unauthorized',
      message: 'Метрики отдаются только с токеном GIB_METRICS_TOKEN.',
      // Минимум для отладки окружения: жив ли сервис и в каком он статусе.
      status: report.status,
      version: report.version,
    },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}
