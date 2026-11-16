import { NextResponse } from 'next/server';
import { funnelBackend, funnelEvents, funnelSize, pruneFunnel } from '@/lib/events/funnel-store';
import { FUNNEL_STEPS, FUNNEL_RETENTION_DAYS, funnelReport, funnelVerdict, paywallStops } from '@/lib/events/funnel';
import { store } from '@/lib/store';
import { YEAR } from '@/lib/content/year';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Воронка запуска: где теряются взрослые.
 *
 * Закрытый маршрут. Доступ — только по токену `GIB_ADMIN_TOKEN`, и без него
 * маршрут отвечает 404, а не 401: существование админского API не должно быть
 * видно перебором. Токен сравнивается постоянным по времени способом — как и
 * токен метрик.
 *
 * Что отдаётся: числа по шагам, конверсии, на какой встрече чаще всего
 * закрывается доступ. Чего не отдаётся: идентификаторы взрослых, имена детей,
 * содержимое ответов. Воронка нужна, чтобы решить, работает ли запуск, а не
 * чтобы следить за семьями.
 *
 * Почему `no-store`: числа меняются после каждого запроса, и закэшированный
 * отчёт показывал бы вчерашний день как сегодняшний.
 */
export async function GET(req: Request) {
  const token = process.env.GIB_ADMIN_TOKEN;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || token.length < 16 || !timingSafeEqual(token, provided)) {
    // 404, а не 401: маршрута «как бы нет».
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!rateLimit(clientKey(req, 'admin-funnel'), 60)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const events = funnelEvents();
  const report = funnelReport(events, { days: 30 });
  const profiles = allProfiles();
  return NextResponse.json({
    verdict: funnelVerdict(report),
    steps: report.steps,
    dropOffStep: report.dropOffStep,
    paywallStops: paywallStops(events, { days: 30 }),
    /**
     * Артефакты выдачи: сколько родителей реально получили профиль. Это не шаг
     * воронки (он про взрослого), а проверка, что создание профиля вообще
     * работает, — иначе «нет трафика» и «сломан онбординг» выглядят одинаково.
     */
    accounts: {
      profiles: profiles.length,
      withConsent: profiles.filter((profile) => Boolean(profile.guardianConsent)).length,
      lessonsInYear: YEAR.lessons.length,
    },
    /**
     * Где живёт воронка. Это не украшение отчёта: в файловом режиме числа
     * исчезают при пересборке контейнера, и дежурный должен видеть разницу
     * между «нет трафика» и «файла больше нет».
     */
    storage: { events: funnelSize(), retentionDays: FUNNEL_RETENTION_DAYS, backend: funnelBackend() },
    generatedAt: Date.now(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Удаление старых событий воронки: вызывается дежурным, не по расписанию. */
export async function POST(req: Request) {
  const token = process.env.GIB_ADMIN_TOKEN;
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || token.length < 16 || !timingSafeEqual(token, provided)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const removed = pruneFunnel();
  return NextResponse.json({ ok: true, removed, steps: FUNNEL_STEPS.length }, { headers: { 'Cache-Control': 'no-store' } });
}

function allProfiles() {
  // Профили нужны только для счётчиков, поэтому берём их через существующий
  // доступ к коллекции, а не заводим второй способ чтения.
  return store.allProfiles();
}

/** Сравнение токена без раннего выхода: длина уже проверена вызывающим. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
