import fs from 'node:fs';
import path from 'node:path';
import type { FunnelEvent, FunnelStep } from './funnel.ts';
import { FUNNEL_RETENTION_DAYS, FUNNEL_STEPS } from './funnel.ts';
import { storeModeOf } from '../store-mode.ts';
import { openBridge } from '../postgres/state-backend.ts';
import { FUNNEL_SCHEMA } from '../postgres/schema.ts';

/**
 * Хранилище событий воронки: отдельная таблица в PostgreSQL или файл рядом с
 * основным хранилищем.
 *
 * Почему отдельно от данных ребёнка. Удаление профиля ребёнка не должно
 * обнулять статистику продаж — иначе после первой же просьбы «удалите данные»
 * отчёт показал бы, что оплат не было, и решение о запуске принималось бы по
 * испорченным числам. Поэтому в PostgreSQL у воронки своя таблица без внешнего
 * ключа на `gib.profiles`, а в файловом режиме — свой файл.
 *
 * Где лежит. Режим тот же, что у данных (`GIB_STORE`): `postgres` — таблица
 * `gib.funnel_events`, иначе — JSON-файл. До этого воронка всегда жила в файле,
 * и продакшен на PostgreSQL терял её при пересборке контейнера: отчёт по
 * запуску показывал бы нули, а «нет трафика» и «файл исчез» выглядели
 * одинаково.
 *
 * Что хранится. Только шаг, владелец и время. Ни имени ребёнка, ни возраста,
 * ни ответов. Владелец — идентификатор аккаунта взрослого, а не ребёнка.
 *
 * Запись не должна ломать основной запрос: если хранилище воронки недоступно,
 * занятие всё равно начинается. Поэтому ошибки записи глотаются осознанно —
 * а вот ошибки чтения видны: отчёт по воронке не имеет права показать ноль
 * там, где он не смог прочитать данные.
 */

/** Файл воронки: используется в режимах `json` и `sqlite`. */
const FILE = process.env.GIB_FUNNEL_FILE
  || (process.env.GIB_DATA_FILE
    ? path.join(path.dirname(process.env.GIB_DATA_FILE), 'funnel.json')
    : path.join(process.cwd(), 'data', 'funnel.json'));
/** Ограничение размера файла: воронка не должна расти бесконечно на диске. */
const MAX_EVENTS = 20000;

type State = { events: FunnelEvent[] };

let cache: State | null = null;

/** Режим, в котором живёт воронка. */
export function funnelBackend(): 'postgres' | 'file' {
  return storeModeOf() === 'postgres' ? 'postgres' : 'file';
}

let pgReady = false;

/**
 * Соединение для воронки. Таблица поднимается при первом обращении: она не
 * входит в схему состояния, потому что у воронки свой срок хранения и своё
 * правило переживать удаление профиля.
 */
function pg() {
  const bridge = openBridge();
  if (!pgReady) {
    for (const statement of FUNNEL_SCHEMA.split(';').map(item => item.trim()).filter(Boolean)) bridge.exec(statement);
    pgReady = true;
  }
  return bridge;
}

function load(): State {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as State).events)) return { events: [] };
    cache = { events: (parsed as State).events.filter(validEvent) };
  } catch {
    cache = { events: [] };
  }
  return cache;
}

function validEvent(value: unknown): value is FunnelEvent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.step === 'string' && typeof record.ownerId === 'string' && record.ownerId.length > 0 && record.ownerId.length <= 200
    && typeof record.at === 'number' && Number.isFinite(record.at) && (record.lessonNumber === undefined || Number.isInteger(record.lessonNumber));
}

function persist(): void {
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
    const temp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 });
    fs.renameSync(temp, FILE);
  } catch {
    // Воронка не должна останавливать занятие: не записали — потеряли событие,
    // а не урок. Причина станет видна по расхождению чисел, а не по 500.
  }
}

/**
 * Записать шаг воронки.
 *
 * Дедупликация — по паре «шаг + владелец»: взрослому нужно пройти шаг один
 * раз, а повтор события (перезагрузка, повтор запроса) не должен раздувать
 * числа. Для `paywall_seen` дедупликация по встрече: интересно, на какой
 * встрече взрослый впервые увидел отказ, а не сколько раз он его открывал.
 *
 * В PostgreSQL это делает первичный ключ таблицы (`ON CONFLICT DO NOTHING`),
 * поэтому два экземпляра приложения не создадут две записи об одном шаге.
 */
export function recordFunnel(event: FunnelEvent): void {
  if (!FUNNEL_STEPS_SET.has(event.step)) return;
  if (funnelBackend() === 'postgres') {
    try {
      pg().query(
        'INSERT INTO gib.funnel_events (step, owner_id, at, lesson_number) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [event.step, event.ownerId, event.at, event.lessonNumber ?? 0],
      );
    } catch {
      // См. `persist()`: занятие важнее статистики. Ошибка чтения при этом
      // видна — отчёт не покажет ноль вместо «не смог прочитать».
    }
    return;
  }
  const state = load();
  const exists = state.events.some((item) =>
    item.step === event.step && item.ownerId === event.ownerId
    && (event.step !== 'paywall_seen' || item.lessonNumber === event.lessonNumber));
  if (exists) return;
  state.events.push({ step: event.step, ownerId: event.ownerId, at: event.at, ...(event.lessonNumber !== undefined ? { lessonNumber: event.lessonNumber } : {}) });
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
  persist();
}

/** Все события воронки: используется отчётом и проверкой готовности. */
export function funnelEvents(): FunnelEvent[] {
  if (funnelBackend() === 'postgres') {
    const rows = pg().query('SELECT step, owner_id, at, lesson_number FROM gib.funnel_events ORDER BY at, step, owner_id');
    return rows.map((row) => {
      const lesson = Number(row.lesson_number ?? 0);
      return {
        step: row.step as FunnelStep,
        ownerId: String(row.owner_id),
        at: Number(row.at),
        ...(Number.isInteger(lesson) && lesson > 0 ? { lessonNumber: lesson } : {}),
      };
    });
  }
  return [...load().events];
}

/** Сколько событий хранится: для метрик и проверки, что хранилище живое. */
export function funnelSize(): number {
  if (funnelBackend() === 'postgres') {
    const row = pg().query('SELECT count(*)::int AS total FROM gib.funnel_events')[0];
    return Number(row?.total ?? 0);
  }
  return load().events.length;
}

/**
 * Удалить события старше срока хранения. Возвращает число удалённых.
 *
 * В PostgreSQL удаление и подсчёт — один запрос: раздельные «посчитать, потом
 * удалить» дали бы число, которое уже не соответствует базе.
 */
export function pruneFunnel(now = Date.now()): number {
  const from = now - FUNNEL_RETENTION_DAYS * 86400000;
  if (funnelBackend() === 'postgres') {
    const row = pg().query(
      'WITH removed AS (DELETE FROM gib.funnel_events WHERE at < $1 RETURNING 1) SELECT count(*)::int AS total FROM removed',
      [from],
    )[0];
    return Number(row?.total ?? 0);
  }
  const state = load();
  const before = state.events.length;
  state.events = state.events.filter((event) => event.at >= from);
  if (state.events.length !== before) persist();
  return before - state.events.length;
}

/** Только для тестов: сбросить кэш после смены файла в окружении. */
export function resetFunnelCache(): void {
  cache = null;
}

/** Все шаги, которые вообще бывают: проверка на опечатку в имени шага. */
export const FUNNEL_STEPS_SET: ReadonlySet<FunnelStep> = new Set(FUNNEL_STEPS);
