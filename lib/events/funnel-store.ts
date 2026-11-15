import fs from 'node:fs';
import path from 'node:path';
import type { FunnelEvent, FunnelStep } from './funnel.ts';
import { FUNNEL_RETENTION_DAYS, FUNNEL_STEPS } from './funnel.ts';

/**
 * Хранилище событий воронки: отдельный файл рядом с основным.
 *
 * Почему отдельно. Удаление профиля ребёнка не должно обнулять статистику
 * продаж — иначе после первой же просьбы «удалите данные» отчёт покажет, что
 * оплат не было, и решение о запуске будет принято по испорченным числам. Но
 * и держать воронку в основной базе нельзя: тогда удаление пришлось бы
 * выборочно переписывать по чужим правилам.
 *
 * Что хранится. Только шаг, владелец и время. Ни имени ребёнка, ни возраста,
 * ни ответов. Владелец — идентификатор аккаунта взрослого, а не ребёнка.
 *
 * Запись не должна ломать основной запрос: если файл воронки недоступен,
 * занятие всё равно начинается. Поэтому ошибки записи глотаются осознанно —
 * а вот ошибки чтения видны в проверке готовности.
 */

/**
 * Файл воронки. По умолчанию — рядом с основным хранилищем, а не в рабочей
 * папке: тесты и прогоны с временным `GIB_DATA_FILE` не должны писать события
 * в данные разработчика, иначе отчёт по воронке смешивает прогоны и жизнь.
 */
const FILE = process.env.GIB_FUNNEL_FILE
  || (process.env.GIB_DATA_FILE
    ? path.join(path.dirname(process.env.GIB_DATA_FILE), 'funnel.json')
    : path.join(process.cwd(), 'data', 'funnel.json'));
/** Ограничение размера: воронка не должна расти бесконечно на диске. */
const MAX_EVENTS = 20000;

type State = { events: FunnelEvent[] };

let cache: State | null = null;

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
 */
export function recordFunnel(event: FunnelEvent): void {
  if (!FUNNEL_STEPS_SET.has(event.step)) return;
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
  return [...load().events];
}

/** Сколько событий хранится: для метрик и проверки, что файл живой. */
export function funnelSize(): number {
  return load().events.length;
}

/** Удалить события старше срока хранения. Возвращает число удалённых. */
export function pruneFunnel(now = Date.now()): number {
  const state = load();
  const from = now - FUNNEL_RETENTION_DAYS * 86400000;
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
