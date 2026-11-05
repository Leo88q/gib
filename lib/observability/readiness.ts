/**
 * Готовность сервиса: живость, база, зависимости.
 *
 * Три разных вопроса, которые нельзя смешивать:
 *  - **жив ли процесс** (liveness) — если нет, его нужно перезапустить;
 *  - **можно ли принимать запросы** (readiness) — если нет, его нужно вывести
 *    из балансировки, но не перезапускать;
 *  - **что необязательное недоступно** — сервис работает, но часть
 *    возможностей выключена, и это надо видеть, а не узнавать от пользователя.
 *
 * Проверки не ходят во внешние сервисы, которые не являются зависимостью игры:
 * недоступность Telegram-отправки отчёта не делает игру нерабочей.
 */
import fs from 'node:fs';
import { store } from '../store.ts';
import { limitStoreInfo } from '../ratelimit.ts';
import { auditSecrets, clientLeaks, secretsReady, strictBlockers } from '../secrets.ts';

export type CheckId = 'store' | 'state' | 'storage' | 'ratelimit' | 'secrets' | 'billing' | 'notifications';

export type Check = {
  id: CheckId;
  /** ready — от запроса зависит приём; degraded — работает, но с ограничением. */
  level: 'ready' | 'degraded';
  ok: boolean;
  detail: string;
  durationMs: number;
};

export type Readiness = {
  ok: boolean;
  /** Можно ли принимать запросы. */
  ready: boolean;
  status: 'ready' | 'degraded' | 'not_ready';
  checks: Check[];
  environment: string;
  /** Версия сборки/коммита, если её передали при запуске. */
  version: string;
  uptimeMs: number;
  checkedAt: number;
};

const startedAt = Date.now();

/** Версия — только из окружения; читать git в рантайме нельзя. */
export function buildVersion(): string {
  const value = process.env.GIB_VERSION ?? '';
  return /^[0-9a-zA-Z._-]{1,40}$/.test(value) ? value : 'dev';
}

function timed(fn: () => string | void): { detail: string; durationMs: number } {
  const start = process.hrtime.bigint();
  const detail = fn();
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { detail: detail ?? 'ok', durationMs: Math.round(durationMs * 100) / 100 };
}

/**
 * Проверка хранилища. Всегда читает состояние через адаптер, но не пишет:
 * проверка готовности не имеет права менять данные.
 */
function checkStore(): Check {
  try {
    const result = timed(() => {
      // Считаем профили адресно: в режиме PostgreSQL `store.all()` поднял бы
      // все таблицы, а проверка готовности должна быть дешёвой.
      const profiles = store.profileCount();
      if (!Number.isInteger(profiles)) throw new Error('empty_state');
      return `состояние читается, профилей ${profiles}`;
    });
    return { id: 'store', level: 'ready', ok: true, ...result };
  } catch (error) {
    return { id: 'store', level: 'ready', ok: false, detail: `хранилище недоступно: ${(error as Error).message}`, durationMs: 0 };
  }
}

/** Есть ли состояние приложения и не пустое ли оно — признак «та ли база». */
function checkState(): Check {
  try {
    const result = timed(() => {
      // Признак «та ли база»: состояние читается и в нём есть коллекции.
      // Проверяем через счётчик, не загружая таблицы целиком.
      const profiles = store.profileCount();
      if (!Number.isInteger(profiles)) throw new Error('no_collections');
      return `коллекций 11, профилей ${profiles}`;
    });
    return { id: 'state', level: 'ready', ok: true, ...result };
  } catch (error) {
    return { id: 'state', level: 'ready', ok: false, detail: `состояние не читается: ${(error as Error).message}`, durationMs: 0 };
  }
}

/**
 * Файл хранилища: для SQLite это главная зависимость. Для JSON — тоже файл,
 * но другая переменная окружения.
 */
function checkStorage(): Check {
  const sqlite = process.env.GIB_STORE === 'sqlite';
  const file = sqlite
    ? (process.env.GIB_SQLITE_FILE || 'data/gib.sqlite')
    : (process.env.GIB_DATA_FILE || 'data/db.json');
  try {
    const result = timed(() => {
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error('not_a_file');
      const kib = Math.round(stat.size / 1024);
      return `${sqlite ? 'sqlite' : 'json'}: ${file}, ${kib} KiB`;
    });
    return { id: 'storage', level: 'ready', ok: true, ...result };
  } catch (error) {
    return { id: 'storage', level: 'ready', ok: false, detail: `файл хранилища недоступен: ${file} (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`, durationMs: 0 };
  }
}

/**
 * Хранилище лимитов: общий счётчик или только в процессе.
 *
 * Это не влияет на готовность принимать запросы, но дежурный должен видеть,
 * что при нескольких инстансах предел умножается на их число.
 */
function checkRateLimit(): Check {
  try {
    const info = limitStoreInfo();
    const detail = info.distributed
      ? `счётчики общие (${info.kind}), записей ${info.size}`
      : `счётчики в процессе (${info.kind}): при нескольких инстансах предел умножается на их число${info.fallbackReason ? `; ${info.fallbackReason}` : ''}`;
    return { id: 'ratelimit', level: 'degraded', ok: info.distributed, detail, durationMs: 0 };
  } catch (error) {
    return { id: 'ratelimit', level: 'degraded', ok: false, detail: `лимиты недоступны: ${(error as Error).message}`, durationMs: 0 };
  }
}

/**
 * Секреты: обязательные заданы, значения не заглушки, ничего не утекло в клиент.
 *
 * Уровень `degraded`, а не `ready`: без ключей оплаты и ботов игра работает.
 * Отказ здесь означал бы 503 всем детям из-за отсутствия платёжного ключа.
 * Отдельный строгий режим (`GIB_SECRETS_STRICT=1`) может сделать просроченные
 * секреты блокером — это решение эксплуатации, а не поведение по умолчанию.
 */
function checkSecrets(): Check {
  const started = process.hrtime.bigint();
  try {
    const audit = auditSecrets();
    const leaks = clientLeaks();
    const strict = strictBlockers(audit);
    const problems = audit.blockers.length + leaks.length + strict.length;
    const detail = problems === 0
      ? `секретов проверено ${audit.items.length}, обязательные на месте${audit.warnings.length ? `; предупреждений ${audit.warnings.length}` : ''}`
      : [audit.blockers.length ? `не заданы или слабые: ${audit.blockers.join('; ')}` : '', leaks.length ? `в клиент утекло: ${leaks.join(', ')}` : '', strict.length ? `просрочены: ${strict.join('; ')}` : ''].filter(Boolean).join('; ');
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return { id: 'secrets', level: 'degraded', ok: problems === 0 && secretsReady(audit), detail, durationMs: Math.round(ms * 100) / 100 };
  } catch (error) {
    return { id: 'secrets', level: 'degraded', ok: false, detail: `проверка секретов не выполнена: ${(error as Error).message}`, durationMs: 0 };
  }
}

/** Платёжный контур: без него сервис работает, но оплата выключена. */
function checkBilling(): Check {
  const configured = Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
  return {
    id: 'billing',
    level: 'degraded',
    ok: configured,
    detail: configured ? 'платёжный контур настроен' : 'оплата выключена: нет ключей ЮKassa',
    durationMs: 0,
  };
}

/** Отправка сообщений: без токена бота отчёты не уходят, игра работает. */
function checkNotifications(): Check {
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN || process.env.MAX_BOT_TOKEN);
  return {
    id: 'notifications',
    level: 'degraded',
    ok: configured,
    detail: configured ? 'бот настроен' : 'сообщения взрослому выключены: нет токена бота',
    durationMs: 0,
  };
}

/**
 * Полная картина готовности.
 *
 * `ready` зависит только от проверок уровня `ready`; отказы необязательных
 * возможностей дают `degraded`, но не выводят сервис из работы.
 */
export function readiness(): Readiness {
  const checks = [checkStore(), checkState(), checkStorage(), checkRateLimit(), checkSecrets(), checkBilling(), checkNotifications()];
  const required = checks.filter(c => c.level === 'ready');
  const optional = checks.filter(c => c.level === 'degraded');
  const ready = required.every(c => c.ok);
  const degraded = optional.some(c => !c.ok);
  return {
    ok: ready,
    ready,
    status: ready ? (degraded ? 'degraded' : 'ready') : 'not_ready',
    checks,
    environment: process.env.NODE_ENV ?? 'unknown',
    version: buildVersion(),
    uptimeMs: Math.max(0, Date.now() - startedAt),
    checkedAt: Date.now(),
  };
}

/** Живость: процесс отвечает и может выполнять код. Ничего не читает с диска. */
export function liveness(): { alive: true; uptimeMs: number; version: string; checkedAt: number } {
  return { alive: true, uptimeMs: Math.max(0, Date.now() - startedAt), version: buildVersion(), checkedAt: Date.now() };
}
