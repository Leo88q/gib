import { NextResponse } from 'next/server';
import { liveness } from '@/lib/observability/readiness';
import { metrics } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';

/**
 * Живость процесса. Отвечает всегда 200, пока Node выполняет этот код.
 *
 * Не читает диск и не ходит в другие сервисы: если проверка живости начнёт
 * зависеть от базы, «мёртвый» и «больной» станут неразличимы, и перезапуск
 * придёт туда, где он не помогает.
 */
export async function GET() {
  metrics.inc('health_checks_total');
  return NextResponse.json(liveness(), { headers: { 'Cache-Control': 'no-store' } });
}
