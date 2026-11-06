import { metrics } from './observability/metrics.ts';
import { MemoryLimitStore, resolveLimitStore, type LimitStore, type ResolvedLimitStore } from './ratelimit-store.ts';

/**
 * Лимит запросов.
 *
 * Хранилище счётчиков выбирается по `GIB_RATE_LIMIT_STORE`:
 *  - `memory` (по умолчанию) — счётчик в процессе; при нескольких инстансах
 *    реальный предел умножается на их число, и это видно в `/api/ready`;
 *  - `sqlite` — общий счётчик в файле, годен для нескольких процессов на одной
 *    машине; атомарный UPSERT внутри транзакции.
 *
 * Кластерного (PostgreSQL) варианта нет: маршруты синхронные, а сетевой вызов
 * синхронным не бывает. Это записано и в регламенте, и в отчёте готовности,
 * чтобы ограничение не выглядело снятым.
 */

let resolved: ResolvedLimitStore | null = null;

/** Ленивая инициализация: тесты успевают выставить окружение до первого запроса. */
function store(): ResolvedLimitStore {
  if (!resolved) {
    resolved = resolveLimitStore();
    if (resolved.fallbackReason) metrics.inc('ratelimit_store_fallback_total');
    if (resolved.store.distributed) metrics.set('ratelimit_store_distributed', 1);
  }
  return resolved;
}

/** Для тестов и отчёта: какое хранилище реально используется. */
export function limitStoreInfo(): { kind: string; distributed: boolean; size: number; fallbackReason?: string } {
  const current = store();
  return { kind: current.store.kind, distributed: current.store.distributed, size: current.store.size(), ...(current.fallbackReason ? { fallbackReason: current.fallbackReason } : {}) };
}

/** Подмена хранилища в тестах: возвращает функцию восстановления. */
export function useLimitStore(next: LimitStore): () => void {
  const previous = resolved;
  resolved = { store: next };
  return () => { resolved = previous; };
}

/** Сброс между тестами: следующий вызов снова прочитает окружение. */
export function resetLimitStore(): void {
  resolved?.store.close();
  resolved = null;
}

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const { store: backend } = store();
  let decision;
  try {
    decision = backend.hit(key, limit, windowMs);
  } catch (error) {
    // Хранилище лимитов сломалось. Отказывать всем — значит уронить игру из-за
    // вспомогательной таблицы; пропускать всех — снять защиту. Выбираем безопасное
    // для пользователя и заметное для дежурного: пропускаем, но громко считаем.
    metrics.inc('ratelimit_store_errors_total');
    return true;
  }
  const scope = key.split(':')[0] || 'unknown';
  metrics.inc(decision.allowed ? `ratelimit_allowed_${scope}_total` : `ratelimit_blocked_${scope}_total`);
  if (!decision.allowed) {
    const retrySeconds = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
    metrics.set('ratelimit_retry_after_seconds', retrySeconds);
  }
  return decision.allowed;
}

/** Решение без метрик: нужно и для проверки правил, и для внутренних вызовов. */
export function decide(key: string, limit = 60, windowMs = 60_000): boolean {
  return store().store.hit(key, limit, windowMs).allowed;
}

/** Очистка истёкших записей: вызывается из обработчика метрик и тестами. */
export function pruneLimits(now = Date.now()): number {
  return store().store.prune(now);
}

/** Периодическая очистка не нужна: истёкшие записи перезаписываются при обращении. */
export function limitStoreKind(): string { return store().store.kind; }

/** Память по умолчанию создаётся один раз, чтобы лимит переживал запросы. */
export const defaultLimitStore = new MemoryLimitStore();

/**
 * Ключ лимита.
 *
 * Заголовки прокси не используются: без доверенного ingress они подконтрольны
 * клиенту, и `X-Forwarded-For` стал бы способом обойти лимит. Подтверждённый
 * владелец получает свой счётчик, неавторизованные запросы делят один.
 */
export function clientKey(_req: Request, scope: string, verifiedParent?: string): string {
  return `${scope}:${verifiedParent ? `parent:${verifiedParent}` : 'anonymous'}`;
}
