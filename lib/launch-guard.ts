/**
 * Прототип использует локальный JSON; платёжный контур и управление доступом
 * не завершены. Его нельзя открывать реальным пользователям. Защита действует
 * в production и не отключается env.
 */
export function apiMustBeBlocked(environment: string | undefined): boolean {
  return environment === 'production';
}

/**
 * Служебные маршруты для дежурного: живость, готовность, метрики.
 *
 * Их нельзя закрывать заглушкой запуска: иначе в production невозможно
 * ответить на вопрос «сервис жив, база работает?» — а именно этот ответ
 * и нужен, чтобы не снимать заглушку вслепую. Они не обслуживают
 * пользователей и не отдают персональные данные.
 */
export const OPS_PATHS = ['/api/health', '/api/ready', '/api/metrics'] as const;

export function isOpsPath(pathname: string): boolean {
  return (OPS_PATHS as readonly string[]).includes(pathname);
}

/** Нужно ли ответить заглушкой 503 на этот путь в этом окружении. */
export function shouldBlockPath(pathname: string, environment: string | undefined): boolean {
  return !isOpsPath(pathname) && apiMustBeBlocked(environment);
}
