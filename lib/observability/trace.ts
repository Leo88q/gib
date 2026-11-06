/**
 * Трассировка запроса: один идентификатор на весь путь обработки.
 *
 * Что это даёт и чего не даёт. Здесь нет распределённой трассировки
 * (OpenTelemetry, сбор в Jaeger/Tempo) — сервис один, и притворяться, что у нас
 * есть спаны между сервисами, значило бы показать наблюдаемость, которой нет.
 * Что **есть** — сквозной `traceId`: он попадает в каждый лог запроса, в
 * ответный заголовок `x-trace-id` и в метрику ошибок, поэтому «одна жалоба» и
 * «десять строк в логе» соединяются без чтения тел запросов.
 *
 * Идентификатор входящего запроса принимается только в безопасном виде и
 * только от доверенного прокси (`GIB_TRUST_TRACE=1`): иначе любой может
 * подставить чужой ID и склеить чужие логи.
 */
export const TRACE_HEADER = 'x-trace-id';

/**
 * Внутренний заголовок запроса: его ставит **своя** middleware и всегда
 * перезаписывает, поэтому обработчик может ему доверять. Внешний `x-trace-id`
 * от клиента так доверять нельзя — иначе любой склеит чужие запросы.
 */
export const TRACE_INTERNAL_HEADER = 'x-gib-trace';

/** Формат: 8–64 символа hex/дефис. Ничего больше — иначе это не ID, а канал. */
const TRACE_PATTERN = /^[a-f0-9][a-f0-9-]{7,63}$/i;

export type TraceContext = {
  traceId: string;
  /** Откуда взят ID: из заголовка или выдан здесь. */
  source: 'header' | 'generated';
  /** Миллисекунды с начала запроса; для логов длительности. */
  startedMs: number;
};

export function isValidTraceId(value: string | null | undefined): value is string {
  return typeof value === 'string' && TRACE_PATTERN.test(value);
}

/**
 * Новый идентификатор: UUID без дефисов, 32 символа.
 *
 * Через Web Crypto (`globalThis.crypto`), а не `node:crypto`: этот же файл
 * импортирует middleware, которая исполняется в Edge-среде, где модулей Node
 * нет. Оба варианта дают криптографически случайный UUID.
 */
export function newTraceId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

/**
 * Определяет трассировку запроса.
 *
 * `trustHeader` включается только за прокси, который сам выставляет заголовок.
 * Без доверия заголовок игнорируется: подделанный ID хуже отсутствующего.
 */
export function traceOf(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = () => Date.now(),
): TraceContext {
  // Сначала внутренний заголовок от своей middleware, затем — внешний, но
  // только за доверенным прокси.
  const internal = request.headers.get(TRACE_INTERNAL_HEADER);
  if (isValidTraceId(internal)) return { traceId: internal, source: 'header', startedMs: now() };
  const trusted = env.GIB_TRUST_TRACE === '1';
  const incoming = trusted ? request.headers.get(TRACE_HEADER) : null;
  if (isValidTraceId(incoming)) return { traceId: incoming, source: 'header', startedMs: now() };
  return { traceId: newTraceId(), source: 'generated', startedMs: now() };
}

/**
 * Поля лога для запроса. Ни URL, ни тела, ни заголовков: ID запроса и имя
 * маршрута из кода — остального для связи строк достаточно.
 */
export function traceFields(context: TraceContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { traceId: context.traceId, traceSource: context.source, ...extra };
}

export function traceHeaders(context: TraceContext): Record<string, string> {
  return { [TRACE_HEADER]: context.traceId };
}

/**
 * Проверка цепочки: по журналу, где каждая строка — JSON, находит все события
 * одного traceId. Нужна тесту и разбору инцидента: связь должна быть
 * доказуемой, а не «мы уверены, что это тот запрос».
 */
export function eventsByTrace(lines: string[], traceId: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.traceId === traceId) found.push(parsed);
    } catch {
      /* не JSON — не наша строка */
    }
  }
  return found;
}
