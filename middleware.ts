import { NextResponse, type NextRequest } from 'next/server';
import { shouldBlockPath } from './lib/launch-guard';

/** До устранения блокеров запрещаем production API, а не выдаём демо за платный сервис. */
export function middleware(request: NextRequest) {
  // Заглушка запуска не должна скрывать от дежурного, жив ли сервис и работает ли база.
  if (shouldBlockPath(request.nextUrl.pathname, process.env.NODE_ENV)) {
    return NextResponse.json(
      { error: 'production_not_ready', message: 'Сервис пока не готов к коммерческому запуску.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export const config = { matcher: ['/api/:path*'] };
