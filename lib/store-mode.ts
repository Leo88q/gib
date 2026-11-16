/**
 * Режим хранилища и одно правило: чем можно пользоваться в продакшене.
 *
 * Раньше режим читался в двух местах по-своему (`lib/store.ts` и проверка
 * готовности), а продакшен не проверял его вовсе. Из-за этого `next start`
 * без `GIB_STORE` тихо работал на файле `data/db.json`: два экземпляра за
 * балансировщиком переписывали бы состояние друг друга, а `funnel.json` и
 * `db.json` жили бы в контейнере, который исчезает при пересборке. Забытая
 * переменная окружения — не повод потерять данные семьи, поэтому файловые
 * режимы в продакшене теперь ** запрещены**, и запрет виден и в `/api/ready`,
 * и в заглушке запуска, а не выясняется по пропавшим профилям.
 *
 * Почему запрет, а не предупреждение. Проверка, которая «просто пишет в лог»,
 * ничего не меняет: дежурный не читает лог, пока всё работает. Заглушка 503
 * останавливает продажу до того, как первый ребёнок останется без прогресса.
 *
 * Почему без флага-обхода. Флаг вида `GIB_ALLOW_FILE_STORE` вернул бы ровно ту
 * же ошибку, от которой защищает: его поставили бы «на минутку» и забыли.
 * Одиночный сервер на SQLite — это другое развёртывание и отдельное решение,
 * а не забытая переменная.
 *
 * Модуль намеренно не импортирует `lib/store.ts`: его читает middleware,
 * работающий на edge-рантайме, где нет `node:sqlite`.
 */

export type StoreMode = 'json' | 'sqlite' | 'postgres';

/** Режим из окружения. По умолчанию `json` — так удобно в разработке. */
export function storeModeOf(env: NodeJS.ProcessEnv = process.env): StoreMode {
  const raw = env.GIB_STORE ?? 'json';
  if (raw !== 'json' && raw !== 'sqlite' && raw !== 'postgres') throw new Error('Unsupported GIB_STORE mode');
  return raw;
}

/**
 * Почему выбранное хранилище нельзя использовать в этом окружении.
 * `null` — можно. В разработке и тестах файл допустим: он один и локальный.
 */
export function storeModeProblem(environment: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (environment !== 'production') return null;
  let mode: StoreMode;
  try {
    mode = storeModeOf(env);
  } catch {
    return 'хранилище: неизвестный GIB_STORE (допустимы json, sqlite, postgres)';
  }
  if (mode === 'postgres') return null;
  const where = mode === 'sqlite'
    ? 'файл SQLite (GIB_SQLITE_FILE)'
    : 'файл JSON (GIB_DATA_FILE), режим по умолчанию';
  return `хранилище: в продакшене нужен postgres, а выбран ${where}`;
}

/** Короткая формулировка для проверки готовности. */
export function storeModeDetail(env: NodeJS.ProcessEnv = process.env): string {
  return `режим ${storeModeOf(env)}`;
}
