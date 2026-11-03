/**
 * Прототип использует локальный JSON; платёжный контур и управление доступом
 * не завершены. Его нельзя открывать реальным пользователям. Защита действует
 * в production и не отключается env.
 */
export function apiMustBeBlocked(environment: string | undefined): boolean {
  return environment === 'production';
}
