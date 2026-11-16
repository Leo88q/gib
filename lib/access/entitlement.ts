import type { MeetingLead } from '../onboarding.ts';
import type { Subscription } from '../types.ts';

/**
 * Что закрыто оплатой, а что открыто всем.
 *
 * До этого файла оплата не закрывала ничего: `/api/session` отдавал занятие
 * любому владельцу профиля, подписка существовала отдельно от содержания.
 * Продукт брал деньги за то, что и так работало. Здесь это решается один раз
 * и проверяется тестом.
 *
 * Принцип простой: **бесплатно то, что человек должен увидеть, чтобы решить.**
 * Первая встреча целиком — история, тренировка и план встречи: без неё нельзя
 * понять, о чём речь. Всё остальное — подписка.
 *
 * Второй принцип: **ребёнок не должен упираться в стену на середине.** Если
 * подписка закончилась 12-го числа, а встреча начата 11-го, занятие
 * доводится до конца. Поэтому отказ (`locked`) выдаётся только на **старте**
 * нового занятия, но не на ответе внутри начатого.
 *
 * Третий принцип: **встречи закрываются только тому, кто их ведёт.** Ребёнку,
 * который занимается сам короткими шагами, план встречи не продаётся: он
 * оплачивает свой режим, а не чужой.
 */

/** Сколько встреч открыто без подписки. */
export const FREE_LESSONS = 1;

/** Сколько дней действует оплата (совпадает с payments.days). */
export const SUBSCRIPTION_DAYS = 30;

export type EntitlementLevel = 'free' | 'paid';

export type Entitlement = {
  level: EntitlementLevel;
  /** Занятие, к которому относится проверка (номер с 1). */
  lessonNumber: number;
  /** Открыто ли это занятие без оплаты. */
  free: boolean;
  /** Номер встречи, после которой продукт просит оплату. null — встреча не входит в оплату. */
  paywallAfterLesson: number | null;
  reason: EntitlementReason;
};

export type EntitlementReason =
  /** Свободная встреча — оплата не нужна. */
  | 'free_lesson'
  /** Подписка действует. */
  | 'subscribed'
  /** Оплата нужна, её нет. */
  | 'payment_required'
  /** Ребёнок выбрал короткие шаги; встречи с планом в его режим не входят. */
  | 'meetings_not_in_mode';

/**
 * Действует ли подписка сейчас.
 *
 * Проверяется только оплаченная подписка: запись из демо или из старой версии
 * без `appliedAt` не считается. Это то же правило, что в `/api/subscribe` GET,
 * но здесь оно одно на весь продукт.
 */
export function activeSubscription(sub: Subscription | undefined, now = Date.now()): boolean {
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  return Number.isFinite(sub.until) && sub.until > now;
}

/**
 * Уровень доступа к занятию.
 *
 * `now` передаётся аргументом, а не берётся из часов внутри: иначе проверку
 * нельзя воспроизвести, а в тестах она будет зависеть от времени запуска.
 */
export function entitlementFor(options: {
  lessonNumber: number;
  lead: MeetingLead | undefined;
  subscription: Subscription | undefined;
  now?: number;
}): Entitlement {
  const now = options.now ?? Date.now();
  /*
   * Номер занятия приходит из расчёта по пройденным дням, а тот — из
   * состояния профиля. Повреждённое состояние не должно открывать всё
   * подряд: NaN и отрицательные значения приводятся к первой встрече, то
   * есть к самому безопасному варианту.
   */
  const requested = Number.isFinite(options.lessonNumber) ? Math.floor(options.lessonNumber) : 1;
  const lessonNumber = Math.max(1, requested);
  const free = lessonNumber <= FREE_LESSONS;
  const subscribed = activeSubscription(options.subscription, now);
  const reason: EntitlementReason = free
    ? 'free_lesson'
    : subscribed
      ? 'subscribed'
      : options.lead === 'child'
        ? 'meetings_not_in_mode'
        : 'payment_required';
  return {
    level: free || subscribed ? 'free' : 'paid',
    lessonNumber,
    free,
    paywallAfterLesson: options.lead === 'child' ? null : FREE_LESSONS,
    reason,
  };
}

/**
 * Можно ли начинать новое занятие.
 *
 * Отдельно от `entitlementFor`: там — состояние, здесь — решение о действии.
 * Демо-повтор уже пройденного занятия не блокируется (`repeat`), потому что
 * повтор не открывает нового содержания и не должен превращаться в наказание
 * за окончание подписки.
 */
export function mayStartLesson(entitlement: Entitlement, options: { repeat?: boolean } = {}): boolean {
  if (options.repeat) return true;
  return entitlement.level === 'free';
}

/**
 * Текст, который видит взрослый у закрытого занятия.
 *
 * Без давления и без «осталось 3 дня»: сначала что открыто, потом что даёт
 * оплата, потом что можно не платить и продолжать первую встречу.
 */
export function paywallCopy(
  reason: EntitlementReason,
  context: 'meeting' | 'session' = 'meeting',
): { title: string; body: string } {
  if (reason === 'meetings_not_in_mode' && context === 'meeting') {
    return {
      title: 'Встречи с планом не входят в короткий режим',
      body: 'Вы выбрали короткие шаги: ребёнок занимается в приложении сам. План встречи и печать — часть режима «взрослый ведёт встречу». Режим можно поменять в кабинете.',
    };
  }
  if (reason === 'meetings_not_in_mode' && context === 'session') {
    return {
      title: 'Первые дни открыты бесплатно, дальше — по подписке',
      body: 'Вы выбрали режим «ребёнок сам, короткими шагами»: первые занятия открыты целиком и бесплатно. Подписка открывает все остальные дни практики и истории на 30 дней без автопродления. Уже пройденные дни всегда доступны для повтора.',
    };
  }
  return {
    title: 'Первая встреча открыта, дальше — по подписке',
    body: 'Первая встреча целиком бесплатна: история, тренировка и план на 40 минут. Подписка открывает остальные 35 встреч и 12 показов. Всё, что ребёнок начал до окончания подписки, можно закончить.',
  };
}

/** Короткая строка для карточки тарифа. */
export function entitlementSummary(entitlement: Entitlement): string {
  if (entitlement.level === 'free') return entitlement.free ? 'Первая встреча открыта без оплаты' : 'Подписка действует';
  return entitlement.reason === 'meetings_not_in_mode' ? 'Встречи не входят в короткий режим' : 'Нужна подписка';
}
