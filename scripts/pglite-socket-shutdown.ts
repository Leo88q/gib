/**
 * Аккуратное завершение тестового PGlite-сокета.
 *
 * Зачем это нужно. В `@electric-sql/pglite-socket` `stop()` обходит обработчики
 * и вызывает у каждого `detach(true)`, но **не ждёт** его: `detach` —
 * асинхронный, и внутри он делает `clearTransactionIfNeeded`, то есть
 * `ROLLBACK`, если соединение оставило открытую транзакцию. Публичный `stop()`
 * возвращает управление раньше, чем откат доехал до базы. Если сразу после
 * этого вызвать `db.close()`, закрытие попадает в середину транзакции —
 * отсюда наблюдаемая изредка ошибка `isInTransaction` при закрытии уже
 * закрытого PGlite. Повтор проходил, потому что гонка недетерминированная.
 *
 * Что делает помощник: прекращает принимать новые соединения (`stop()`),
 * ждёт, пока база выйдет из транзакции, и только потом отдаёт управление
 * вызывающему, который закрывает базу. Ожидание ограничено по времени: если
 * транзакция не закрылась за отведённое время, это не повод вешать тест —
 * дальше закрываем как раньше, но сообщаем об этом.
 *
 * Это исправление тестовой инфраструктуры, а не production-кода: сокет
 * существует только в тестах, живой PostgreSQL закрывается обычным `end()`.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

export async function stopPgliteSocketServer(
  server: PGLiteSocketServer,
  db: PGlite,
  { timeoutMs = 5000, pollMs = 10 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  await server.stop();

  // stop() не дождался detach, поэтому откат может быть ещё в пути. Ждём не
  // просто «транзакция закрыта», а ещё и тишину после этого: detach заканчивает
  // ROLLBACK через `db.exec`, и вызов `close()` ровно в этот момент — та самая
  // гонка. Две подряд спокойные проверки с паузой дают отложенному exec время
  // завершиться.
  const deadline = Date.now() + timeoutMs;
  let quiet = 0;
  while (quiet < 2) {
    if (!db.isInTransaction()) quiet++;
    else quiet = 0;
    if (Date.now() > deadline) {
      // Не роняем тест из-за инфраструктуры, но и не прячем проблему.
      console.warn('pglite-socket: база не успокоилась за отведённое время, закрываем как есть');
      return;
    }
    await sleep(pollMs);
  }
}

/** Удобная форма для `finally`: сокет, затем база, затем временный каталог. */
export async function shutdownPgliteSocketServer(
  server: PGLiteSocketServer | undefined,
  db: PGlite | undefined,
): Promise<void> {
  if (server && db) await stopPgliteSocketServer(server, db);
  else if (server) await server.stop();
  if (db) await db.close();
}
