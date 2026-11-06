/**
 * Замер длительности обработчика маршрута и запись результата в метрики.
 *
 * Намеренно простой: без декораторов и без автоматического перехвата всех
 * маршрутов. Метрика включается там, где её читают, чтобы не плодить ряды
 * в памяти и не создавать видимость наблюдаемости, которой нет.
 *
 * Трассировка здесь же: идентификатор запроса берётся из заголовка (только за
 * доверенным прокси) или выдаётся, попадает в поля лога об ошибке и в заголовок
 * ответа. Ни URL, ни тела, ни заголовков авторизации в лог не идёт.
 */
import { metrics } from './metrics';
import { logDebug, logError } from './log';
import { TRACE_HEADER, traceFields, traceHeaders, traceOf, type TraceContext } from './trace';

/** Контекст маршрута, который Next передаёт вторым аргументом. */
export type RouteContext = { traceId?: string } | undefined;

/**
 * Обёртка обработчика: считает запросы, ошибки и время, связывает логи.
 *
 * @param route имя маршрута из кода (не из URL), например `session.command`
 * @param handler сам обработчик
 * @param fields дополнительные поля лога, которые можно вычислить из контекста
 */
export function measured<Args extends unknown[], R>(
  route: string,
  handler: (...args: Args) => Promise<R> | R,
  fields?: (context: RouteContext) => Record<string, unknown>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const started = process.hrtime.bigint();
    const context: TraceContext | undefined = args[0] instanceof Request ? traceOf(args[0]) : undefined;
    const extra = fields ? fields({ traceId: context?.traceId }) : {};
    try {
      const result = await handler(...args);
      metrics.inc(`http_${route}_total`);
      // Строка на каждый запрос — только на уровне debug: она нужна, чтобы
      // жалоба с идентификатором из ответа находилась в журнале, а не чтобы
      // писать журнал ради объёма. Тело, URL и заголовки не пишутся.
      if (context) logDebug('request_done', { route, ...traceFields(context) });
      return withTrace(result, context);
    } catch (error) {
      metrics.inc(`http_${route}_errors_total`);
      // В лог попадает имя маршрута, traceId и текст ошибки, без аргументов
      // запроса: аргументы содержат тело и заголовки, а там подписи и данные ребёнка.
      logError('request_failed', { route, ...(context ? traceFields(context) : {}), ...extra, error });
      throw error;
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.observe(`http_${route}_duration`, ms);
    }
  };
}

/**
 * Добавляет `x-trace-id` к успешному ответу.
 *
 * Заголовок нужен, чтобы жалоба пользователя несла идентификатор: без него
 * «у меня не работает» не соединить с конкретной строкой журнала. Тело ответа
 * не трогаем — идентификатор не должен попадать в данные ребёнка.
 */
function withTrace<R>(result: R, context: TraceContext | undefined): R {
  if (!context || !(result instanceof Response)) return result;
  try {
    result.headers.set('x-trace-id', (traceHeaders(context) as Record<string, string>)[TRACE_HEADER]);
    return result;
  } catch {
    // Заголовки неизменяемы (например, ответ уже отдан) — не роняем запрос из-за телеметрии.
    return result;
  }
}
