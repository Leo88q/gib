/**
 * Каталог наблюдаемых сигналов: единственное место, где перечислено, что именно
 * сервис умеет измерять.
 *
 * Зачем отдельный файл. Правила алертов, grafana-панели и проверка «метрика
 * действительно существует» должны опираться на один список имён. Если писать
 * имена руками в YAML, легко получить правило на метрику, которой нет: оно
 * будет молчать всегда, и отсутствие тревоги примет за спокойствие. Каталог
 * генерирует правила (`scripts/gen-alerts.ts`), и он же проверяется тестом.
 *
 * Имена метрик строятся только из кода. Ни одно имя здесь не зависит от
 * пользователя — иначе кардинальность выросла бы из данных ребёнка.
 */

/** Области лимитов: ровно те, что вызывает код (`clientKey(req, '<scope>')`). */
export const RATE_LIMIT_SCOPES = [
  'billing-webhook',
  'family',
  'family-goal',
  'feelings',
  'feelings-delete',
  'feelings-post',
  'notifications',
  'notifications-write',
  'parent-pin',
  'parent-pin-del',
  'player',
  'practice-map',
  'profile',
  'profile-delete',
  'profile-export',
  'profile-post',
  'profile-update',
  'program',
  'program-write',
  'report',
  'session',
  'subscribe',
  'subscribe-post',
  'telegram-report',
] as const;

export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];

/** Маршруты под `measured(...)`: только они дают гистограммы длительности. */
export const MEASURED_ROUTES = ['session.info', 'session.command'] as const;

/** Проверки готовности (`CheckId` в `readiness.ts`). */
export const READINESS_CHECKS = ['store', 'state', 'storage', 'ratelimit', 'billing', 'notifications'] as const;

/** Проверки, без которых принимать запросы нельзя. */
export const REQUIRED_CHECKS = ['store', 'state', 'storage'] as const;

/**
 * Имена метрик в том виде, в каком их отдаёт `/api/metrics` (с префиксом `gib_`).
 *
 * `dynamic: true` — имя образуется подстановкой; такие перечислены полностью,
 * чтобы правила могли ссылаться на конкретную область или маршрут.
 */
export function metricNames(prefix = 'gib'): string[] {
  const p = `${prefix}_`;
  const names: string[] = [
    `${p}uptime_seconds`,
    `${p}health_checks_total`,
    `${p}metrics_scrapes_total`,
    `${p}metrics_dropped_total`,
    `${p}readiness_checks_ok_total`,
    `${p}readiness_checks_failed_total`,
    `${p}readiness_degraded_checks`,
    `${p}ratelimit_store_fallback_total`,
    `${p}ratelimit_store_errors_total`,
  ];
  for (const scope of RATE_LIMIT_SCOPES) {
    names.push(`${p}ratelimit_allowed_${scope}_total`, `${p}ratelimit_blocked_${scope}_total`);
  }
  for (const route of MEASURED_ROUTES) {
    const base = `${p}http_${route.replace(/\./g, '_')}`;
    names.push(`${base}_total`, `${base}_errors_total`, `${base}_duration_bucket`, `${base}_sum`, `${base}_count`);
  }
  for (const check of READINESS_CHECKS) {
    names.push(`${p}check_${check}_ok_total`, `${p}check_${check}_failed_total`);
  }
  return names;
}
