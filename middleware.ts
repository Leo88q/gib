import { NextResponse, type NextRequest } from 'next/server';
import { shouldBlockPath } from './lib/launch-guard';
import { TRACE_HEADER, TRACE_INTERNAL_HEADER, newTraceId } from './lib/observability/trace';

/**
 * Идентификатор запроса на входе в сервис.
 *
 * Выдаётся здесь, а не в обработчике, чтобы он был у **каждого** ответа,
 * включая заглушку 503 и отказы middleware: иначе самая неприятная ситуация
 * («сервис закрыт») осталась бы без идентификатора для обращения. Значение
 * передаётся дальше заголовком запроса, поэтому обработчик (`measured`) видит
 * тот же ID и пишет его в лог.
 *
 * Входящий `x-trace-id` принимается только при `GIB_TRUST_TRACE=1`: за
 * доверенным прокси заголовок ставит он, а без доверия подставленный ID
 * склеил бы чужие запросы в одну цепочку.
 */
function incomingTrace(request: NextRequest): string {
  const provided = request.headers.get(TRACE_HEADER);
  if (process.env.GIB_TRUST_TRACE === '1' && provided && /^[a-f0-9][a-f0-9-]{7,63}$/i.test(provided)) return provided;
  return newTraceId();
}

/** До устранения блокеров запрещаем production API, а не выдаём демо за платный сервис. */
export function middleware(request: NextRequest) {
  const traceId = incomingTrace(request);
  // Заглушка запуска не должна скрывать от дежурного, жив ли сервис и работает ли база.
  if (shouldBlockPath(request.nextUrl.pathname, process.env.NODE_ENV)) {
    return NextResponse.json(
      { error: 'production_not_ready', message: 'Сервис пока не готов к коммерческому запуску.' },
      { status: 503, headers: { 'Cache-Control': 'no-store', [TRACE_HEADER]: traceId } },
    );
  }
  // Заголовки запроса передаются обработчику: там тот же ID попадёт в лог.
  const headers = new Headers(request.headers);
  // Перезаписываем всегда: клиент не должен подсунуть свой «внутренний» ID.
  headers.set(TRACE_INTERNAL_HEADER, traceId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}

export const config = { matcher: ['/api/:path*'] };
