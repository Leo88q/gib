import type { StoredEvent } from './journal.ts';
import type { Subscription, Profile } from '../types.ts';

/**
 * Воронка запуска: шесть шагов, после которых вопрос «работает ли это»
 * становится арифметикой, а не мнением.
 *
 * Почему отдельный файл, а не «просто события». Журнал технических событий уже
 * есть, но по нему нельзя ответить на главный вопрос: где теряются люди. Для
 * этого нужен порядок шагов и один владелец, чьи шаги считаются. Здесь
 * описаны и порядок, и способ подсчёта, и он проверяется тестом на синтетике.
 *
 * Что не считается. Не считается «время в приложении», клики и глубина
 * прокрутки: это метрики давления на ребёнка, а не продукта. Не считается
 * ничего из содержания ответов — только факт шага.
 *
 * Воронка считается по **владельцу** (взрослому), а не по профилю ребёнка:
 * платит взрослый, и теряется на шагах тоже он. Семья с двумя детьми —
 * один проход воронки.
 */

export const FUNNEL_STEPS = [
  /** Онбординг закончен: взрослый ответил на два вопроса и дал согласие. */
  'consent',
  /** Создан профиль ребёнка. */
  'profile',
  /** Ребёнок начал первое занятие. */
  'first_session',
  /** Ребёнок закончил первое занятие. */
  'first_finished',
  /** Взрослому показан экран оплаты у закрытого занятия. */
  'paywall_seen',
  /** Оплата подтверждена провайдером. */
  'paid',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * События воронки — отдельно от учебных событий.
 *
 * Учебный журнал отвечает «что делал ребёнок»; воронка — «дошёл ли взрослый
 * до оплаты». Смешивать их нельзя: у воронки свой срок хранения и она
 * переживает удаление профиля — иначе удаление ребёнка обнуляло бы статистику
 * продаж.
 *
 * Событие воронки не содержит ничего о ребёнке: ни имени, ни возраста, ни
 * ответов. Только шаг и владелец.
 */
export type FunnelEvent = {
  step: FunnelStep;
  /** Владелец аккаунта. В отчёте не выводится, только для подсчёта уникальных. */
  ownerId: string;
  at: number;
  /** Для `paywall_seen`: номер встречи, у которой встал доступ. */
  lessonNumber?: number;
};

/** Сколько хранится событие воронки. */
export const FUNNEL_RETENTION_DAYS = 400;

export type FunnelReport = {
  steps: { step: FunnelStep; owners: number; /** Доля от предыдущего шага, 0..1. */ conversion: number }[];
  /** Где теряется больше всего — шаг с наименьшей конверсией. */
  dropOffStep: FunnelStep | null;
  /** Сколько владельцев дошли до оплаты. */
  paid: number;
};

const EMPTY = 0;

function within(events: FunnelEvent[], days: number, now: number): FunnelEvent[] {
  const from = now - days * 86400000;
  return events.filter((event) => Number.isFinite(event.at) && event.at >= from);
}

/**
 * Отчёт по воронке.
 *
 * Считаются уникальные владельцы на каждом шаге и конверсия к предыдущему.
 * Шаг, который никто не прошёл, конверсии не получает: `NaN` и «0%» путать
 * нельзя — первое значит «не с чем сравнивать», второе значит «были и ушли».
 */
export function funnelReport(events: FunnelEvent[], options: { days?: number; now?: number } = {}): FunnelReport {
  const now = options.now ?? Date.now();
  const days = options.days ?? 30;
  const recent = within(events, days, now);
  const owners = (step: FunnelStep) => new Set(recent.filter((event) => event.step === step).map((event) => event.ownerId));

  let previous: number | null = null;
  let dropOffStep: FunnelStep | null = null;
  let worst = 2;
  const steps = FUNNEL_STEPS.map((step) => {
    const count = owners(step).size;
    const conversion = previous === null || previous === EMPTY ? (step === FUNNEL_STEPS[0] ? 1 : 0) : count / previous;
    if (previous !== null && previous > 0) {
      const lost = count / previous;
      if (lost < worst) { worst = lost; dropOffStep = step; }
    }
    previous = count;
    return { step, owners: count, conversion: Math.round(conversion * 1000) / 1000 };
  });

  return {
    steps,
    dropOffStep: steps[0] && steps[0].owners === 0 ? null : dropOffStep,
    paid: steps[steps.length - 1].owners,
  };
}

/**
 * Взрослые, которые дошли до экрана оплаты и не заплатили.
 *
 * Это не «потерянные», а очередь на разговор: их видно по номеру встречи,
 * на которой доступ закрылся. Список владельцев не отдаётся наружу — только
 * количество по встречам.
 */
export function paywallStops(events: FunnelEvent[], options: { days?: number; now?: number } = {}): Record<number, number> {
  const now = options.now ?? Date.now();
  const recent = within(events, options.days ?? 30, now);
  const paid = new Set(recent.filter((event) => event.step === 'paid').map((event) => event.ownerId));
  const stops: Record<number, number> = {};
  for (const event of recent) {
    if (event.step !== 'paywall_seen' || paid.has(event.ownerId)) continue;
    const lesson = Math.max(1, Math.floor(event.lessonNumber ?? 1));
    stops[lesson] = (stops[lesson] ?? 0) + 1;
  }
  return stops;
}

/**
 * Статус запуска по воронке.
 *
 * Отдаётся в `/api/admin/funnel` и используется решением «снимать ли
 * заглушку». Порог — наличие оплат: если ни один взрослый не дошёл до
 * оплаты, неважно, сколько было занятий.
 */
export function funnelVerdict(report: FunnelReport): 'no_traffic' | 'no_activation' | 'no_payment' | 'working' {
  const [consent, , , , , paid] = report.steps.map((step) => step.owners);
  if (consent === 0) return 'no_traffic';
  if (paid === 0) {
    const activated = report.steps.find((step) => step.step === 'first_session')?.owners ?? 0;
    return activated === 0 ? 'no_activation' : 'no_payment';
  }
  return 'working';
}

/**
 * Учебные события, которые дублируют шаги воронки.
 *
 * Воронка не вводит новых правок в движок: `session_started` и
 * `session_completed` уже пишутся. Здесь — перевод одного в другое, чтобы
 * отчёт считался по факту, а не по утверждению клиента. `session_completed`
 * есть только у первого занятия ребёнка — но для шага «первое занятие
 * закончено» этого достаточно: считается уникальный владелец, а не занятие.
 */
export function funnelFromLearning(events: StoredEvent[], profiles: Profile[], subs: Subscription[]): FunnelEvent[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const out: FunnelEvent[] = [];
  for (const stored of events) {
    const profile = byId.get(stored.profileId);
    if (!profile) continue;
    if (stored.event.type === 'profile_created') {
      out.push({ step: 'profile', ownerId: stored.ownerId, at: stored.at });
      if (profile.guardianConsent) out.push({ step: 'consent', ownerId: stored.ownerId, at: profile.guardianConsent.at });
    }
    if (stored.event.type === 'session_started') {
      out.push({ step: 'first_session', ownerId: stored.ownerId, at: stored.at });
    }
    if (stored.event.type === 'session_completed') {
      // Номер встречи не выводим из учебного события: воронке он нужен только
      // у отказа в доступе, а тот приходит своим событием.
      out.push({ step: 'first_finished', ownerId: stored.ownerId, at: stored.at });
    }
  }
  for (const sub of subs) {
    const profile = byId.get(sub.profileId);
    if (!profile || sub.status !== 'active') continue;
    out.push({ step: 'paid', ownerId: profile.parentId, at: sub.startedAt });
  }
  // Согласие могло быть дано раньше профиля: берём запись из профиля, а не из
  // учебного события, чтобы воронка не зависела от того, успел ли журнал.
  for (const profile of profiles) {
    if (profile.guardianConsent) out.push({ step: 'consent', ownerId: profile.parentId, at: profile.guardianConsent.at });
  }
  return out;
}
