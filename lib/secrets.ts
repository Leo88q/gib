/**
 * Управление секретами: что обязательно, что просрочено, когда ротировать.
 *
 * Здесь нет хранилища секретов (Vault и подобного) и нет мечты, что оно есть:
 * значения по-прежнему приходят из окружения. Что здесь **есть** — учёт:
 * какой секрет для чего нужен, минимальная длина, возраст, история ротации и
 * запрет держать секреты под именами, которые утекают в клиент.
 *
 * Почему учёт важнее хранилища. Секрет без владельца и без срока живёт годами
 * и переживает всех, кто его выпустил. Дешёвая часть дисциплины — список,
 * сроки и отказ запускаться с дырой — закрывается без Vault, и только она
 * делает переход в Vault осмысленным.
 */

/** Вид секрета определяет правила: длину, срок и последствия отсутствия. */
export type SecretKind = 'credential' | 'key' | 'token';

export type SecretSpec = {
  /** Имя переменной окружения. */
  env: string;
  kind: SecretKind;
  /** Для чего нужен — текстом, который попадёт в отчёт и регламент. */
  purpose: string;
  /** Минимальная длина значения. */
  minLength: number;
  /** Без секрета нельзя запускаться в production. */
  required: boolean;
  /** Через сколько дней значение считается просроченным; 0 — срок не задан. */
  maxAgeDays: number;
};

/**
 * Реестр секретов сервиса. Только имена и правила — значений здесь нет и быть
 * не может.
 *
 * Платёжные ключи и токены ботов обязательны для production: без них оплата и
 * сообщения молча выключаются, и это должно быть решением, а не сюрпризом.
 * Токен метрик обязателен, но его отсутствие не мешает играть — поэтому оно
 * даёт предупреждение, а не отказ.
 */
export const SECRETS: readonly SecretSpec[] = [
  { env: 'TELEGRAM_BOT_TOKEN', kind: 'token', purpose: 'бот в Telegram: вход ребёнка и отчёты родителю', minLength: 30, required: true, maxAgeDays: 365 },
  { env: 'MAX_BOT_TOKEN', kind: 'token', purpose: 'бот в MAX: вход и отчёты', minLength: 20, required: true, maxAgeDays: 365 },
  { env: 'YOOKASSA_SHOP_ID', kind: 'credential', purpose: 'идентификатор магазина для оплаты', minLength: 4, required: true, maxAgeDays: 0 },
  { env: 'YOOKASSA_SECRET_KEY', kind: 'key', purpose: 'секретный ключ оплаты, подпись платёжных запросов', minLength: 20, required: true, maxAgeDays: 365 },
  { env: 'GIB_BACKUP_KEY_HEX', kind: 'key', purpose: 'ключ шифрования резервных копий (AES-256-GCM)', minLength: 64, required: true, maxAgeDays: 365 },
  { env: 'GIB_METRICS_TOKEN', kind: 'token', purpose: 'доступ к /api/metrics', minLength: 16, required: false, maxAgeDays: 180 },
] as const;

export type SecretStatus = 'ok' | 'missing' | 'too_short' | 'stale' | 'shape';

export type SecretReport = {
  env: string;
  kind: SecretKind;
  purpose: string;
  status: SecretStatus;
  /** Длина значения — не само значение. */
  length: number;
  /** Сколько дней значению, если возраст известен. */
  ageDays?: number;
  note: string;
};

export type SecretAudit = {
  /** Можно ли стартовать: нет обязательных дыр и слабых значений. */
  ready: boolean;
  /** Секреты, без которых production запускать нельзя. */
  blockers: string[];
  /** Не мешают запуску, но требуют внимания. */
  warnings: string[];
  items: SecretReport[];
};

/** Проверка формы: значения, которые точно не секрет. */
function shapeProblem(value: string): string | null {
  if (/^(changeme|example|test|demo|secret|password|todo|xxx+)$/i.test(value)) return 'значение-заглушка';
  if (/^[a-z]*(test|demo|example)[a-z_]*$/i.test(value)) return 'значение похоже на тестовое';
  if (value.trim() !== value) return 'пробелы по краям';
  if (/[\n\r]/.test(value)) return 'перевод строки внутри значения';
  return null;
}

/** Возраст значения в днях по отметке `*_ROTATED_AT` (ISO-дата). */
function ageInDays(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return undefined;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

/**
 * Проверяет секреты окружения.
 *
 * Возраст берётся из `GIB_SECRET_<ИМЯ>_ROTATED_AT`. Без отметки возраст
 * **неизвестен**, а не «свежий»: незнание не должно выглядеть как порядок.
 * Поэтому при заданном сроке отсутствие отметки даёт предупреждение.
 */
export function auditSecrets(env: NodeJS.ProcessEnv = process.env, now = new Date()): SecretAudit {
  const items: SecretReport[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const spec of SECRETS) {
    const raw = env[spec.env];
    const stampEnv = `GIB_SECRET_${spec.env.replace(/[^A-Z0-9]/gi, '_').toUpperCase()}_ROTATED_AT`;
    const stamp = env[stampEnv];
    const ageDays = ageInDays(stamp, now);

    if (!raw) {
      items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'missing', length: 0, note: spec.required ? 'обязателен для production' : 'необязателен: выключает только свою возможность' });
      (spec.required ? blockers : warnings).push(`${spec.env}: не задан`);
      continue;
    }

    const shape = shapeProblem(raw);
    if (shape) {
      items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'shape', length: raw.length, ageDays, note: shape });
      blockers.push(`${spec.env}: ${shape}`);
      continue;
    }
    if (raw.length < spec.minLength) {
      items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'too_short', length: raw.length, ageDays, note: `короче ${spec.minLength} символов` });
      blockers.push(`${spec.env}: короче ${spec.minLength} символов`);
      continue;
    }

    if (spec.maxAgeDays > 0) {
      if (ageDays === undefined) {
        items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'ok', length: raw.length, note: `возраст неизвестен: нет отметки ${stampEnv}` });
        warnings.push(`${spec.env}: возраст неизвестен — задать ${stampEnv}`);
        continue;
      }
      if (ageDays > spec.maxAgeDays) {
        items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'stale', length: raw.length, ageDays, note: `просрочен: ${ageDays} дн. при сроке ${spec.maxAgeDays}` });
        // Просроченный секрет — не дыра сама по себе; в отказ его переводит
        // отдельное решение эксплуатации (см. GIB_SECRETS_STRICT).
        warnings.push(`${spec.env}: просрочен (${ageDays} дн. при сроке ${spec.maxAgeDays})`);
        continue;
      }
    }

    items.push({ env: spec.env, kind: spec.kind, purpose: spec.purpose, status: 'ok', length: raw.length, ageDays, note: ageDays === undefined ? 'в порядке, возраст неизвестен' : `в порядке, возраст ${ageDays} дн.` });
  }

  return { ready: blockers.length === 0, blockers, warnings, items };
}

/**
 * Строгий режим: просроченные секреты тоже не пускают.
 *
 * Включается `GIB_SECRETS_STRICT=1`. По умолчанию выключен: иначе обновление
 * отметки о ротации останавливало бы работающий сервис.
 */
export function strictBlockers(audit: SecretAudit, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.GIB_SECRETS_STRICT !== '1') return [];
  return audit.items.filter(i => i.status === 'stale').map(i => `${i.env}: просрочен (${i.ageDays} дн.)`);
}

/** Итоговая готовность секретов с учётом строгого режима. */
export function secretsReady(audit: SecretAudit, env: NodeJS.ProcessEnv = process.env): boolean {
  return audit.ready && strictBlockers(audit, env).length === 0;
}

/**
 * Ротация ключа резервных копий.
 *
 * Ключ шифрования нельзя «просто заменить»: старые копии останутся зашифрованы
 * прежним. Здесь два имени — текущий ключ и предыдущий для чтения. Новые копии
 * шифруются текущим; читаются обоими. Это и есть безопасная ротация без потери
 * доступа, и её отсутствие — самая частая причина, по которой ключ не меняют
 * годами.
 */
export type RotationView = {
  env: string;
  current: boolean;
  previous: boolean;
  /** Можно ли расшифровать копию этим ключом (для чтения). */
  readable: boolean;
};

export function rotationView(env: NodeJS.ProcessEnv = process.env): RotationView[] {
  const current = Boolean(env.GIB_BACKUP_KEY_HEX);
  const previous = Boolean(env.GIB_BACKUP_KEY_PREVIOUS_HEX);
  const same = current && previous && env.GIB_BACKUP_KEY_HEX === env.GIB_BACKUP_KEY_PREVIOUS_HEX;
  return [
    { env: 'GIB_BACKUP_KEY_HEX', current: true, previous: false, readable: current },
    { env: 'GIB_BACKUP_KEY_PREVIOUS_HEX', current: false, previous: true, readable: previous && !same },
  ];
}

/** Что сказать при ротации: порядок шагов, а не пожелание. */
export function rotationPlan(): string[] {
  return [
    '1. Сгенерировать новый ключ: openssl rand -hex 32.',
    '2. Положить текущий в GIB_BACKUP_KEY_PREVIOUS_HEX, новый — в GIB_BACKUP_KEY_HEX.',
    '3. Перезапустить сервис: новые копии шифруются новым, старые читаются прежним.',
    '4. Сделать пробное восстановление старой копии — без него ротация не завершена.',
    '5. Перешифровать архивные копии новым ключом и только потом убрать GIB_BACKUP_KEY_PREVIOUS_HEX.',
    '6. Поставить отметку GIB_SECRET_GIB_BACKUP_KEY_HEX_ROTATED_AT текущей датой.',
  ];
}

/**
 * Длина секрета и его отпечаток для логов: сам секрет не выводится никогда,
 * но «это тот же ключ или нет» по отпечатку видно.
 */
export function fingerprint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Переменные, которые не должны начинаться с `NEXT_PUBLIC_`: всё с этим
 * префиксом Next.js вкомпилирует в клиентский бандл. Секрет, попавший туда,
 * перестаёт быть секретом навсегда — его видят все.
 */
export const CLIENT_PREFIX = 'NEXT_PUBLIC_';

export function clientLeaks(env: NodeJS.ProcessEnv = process.env): string[] {
  const sensitive = /(TOKEN|SECRET|KEY|PASSWORD|INIT_DATA|PRIVATE)/i;
  return Object.keys(env)
    .filter(name => name.startsWith(CLIENT_PREFIX) && sensitive.test(name.slice(CLIENT_PREFIX.length)))
    .sort();
}
