/**
 * Замер длительности обработчика маршрута и запись результата в метрики.
 *
 * Намеренно простой: без декораторов и без автоматического перехвата всех
 * маршрутов. Метрика включается там, где её читают, чтобы не плодить ряды
 * в памяти и не создавать видимость наблюдаемости, которой нет.
 */
import { metrics } from './metrics';
import { logError } from './log';

/**
 * Обёртка обработчика: считает запросы, ошибки и время.
 *
 * @param route имя маршрута из кода (не из URL), например `session.start`
 * @param handler сам обработчик
 */
export function measured<Args extends unknown[], R>(route: string, handler: (...args: Args) => Promise<R> | R): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const started = process.hrtime.bigint();
    try {
      const result = await handler(...args);
      metrics.inc(`http_${route}_total`);
      return result;
    } catch (error) {
      metrics.inc(`http_${route}_errors_total`);
      // В лог попадает только имя маршрута и текст ошибки, без аргументов запроса:
      // аргументы содержат тело и заголовки, а там подписи и данные ребёнка.
      logError('request_failed', { route, error });
      throw error;
    } finally {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.observe(`http_${route}_duration`, ms);
    }
  };
}
