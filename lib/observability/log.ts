/**
 * Структурированные логи: одна строка JSON на событие.
 *
 * Что здесь важнее всего — чего в логах **не будет**:
 *  - `initData` и любые подписи платформ;
 *  - токены ботов, ключи платёжного контура, ключ резервных копий;
 *  - имя ребёнка, возраст, содержимое ответов, отметки чувств;
 *  - идентификаторы профиля вместо них — короткий хеш владельца, если нужен
 *    для отладки (только при явно включённой отладке).
 *
 * Даже если вызывающий код случайно передаст секрет в поле, он вырезается
 * на выходе: защита не полагается на дисциплину вызывающих.
 */

/** Ключи, значения которых никогда не выводятся. */
const SECRET_KEYS = /^(authorization|cookie|set-cookie|x-telegram-init-data|x-max-init-data|initdata|hash|token|password|secret|apikey|api_key|gib_backup_key_hex|payload|body|query|feelings|name|user)$/i;

/** Значения, похожие на секреты, вырезаются даже в свободном тексте. */
const SECRET_VALUE = [
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g,          // токен Telegram-бота
  /\b[a-fA-F0-9]{64}\b/g,                       // ключ резервной копии (32 байта)
  /\b(?:query_id|hash|auth_date|signature)=[^\s&]+/gi, // подпись initData
];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.GIB_LOG_LEVEL ?? '').toLowerCase() as LogLevel;
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  return process.env.NODE_ENV === 'test' ? LEVEL_ORDER.warn : LEVEL_ORDER.info;
}

/** Стабильный короткий отпечаток владельца вместо самого идентификатора. */
export function ownerTag(parentId: string | undefined): string | undefined {
  if (!parentId || process.env.GIB_LOG_OWNERS !== '1') return undefined;
  // FNV-1a: не криптография, но и не обратимое значение; нужен только для группировки.
  let hash = 0x811c9dc5;
  for (let i = 0; i < parentId.length; i++) {
    hash ^= parentId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function scrubValue(value: string): string {
  let result = value;
  for (const pattern of SECRET_VALUE) result = result.replace(pattern, '[redacted]');
  return result;
}

function scrub(depth: number, key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (SECRET_KEYS.test(key)) return '[redacted]';
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return scrubValue(value).slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => scrub(depth + 1, key, item));
  if (value instanceof Error) return { name: value.name, message: scrubValue(value.message).slice(0, 500) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) out[k] = scrub(depth + 1, k, v);
    return out;
  }
  return '[unserializable]';
}

export type LogFields = Record<string, unknown>;

/** Очищает поля для лога. Экспортируется, чтобы это можно было проверить тестом. */
export function redact(fields: LogFields): LogFields {
  return scrub(0, '', fields) as LogFields;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event: scrubValue(event).slice(0, 120),
    ...redact(fields),
  };
  // Один write на строку: не блокирует и не смешивает части сообщений.
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const logInfo = (event: string, fields?: LogFields) => log('info', event, fields);
export const logWarn = (event: string, fields?: LogFields) => log('warn', event, fields);
export const logError = (event: string, fields?: LogFields) => log('error', event, fields);
