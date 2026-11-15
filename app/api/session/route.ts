import { weekArt } from '@/lib/art-paths';
import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { measured } from '@/lib/observability/measure';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { createStoreJournal } from '@/lib/events/store-journal';
import { ownedProfile as ownedProfileForOwner } from '@/lib/auth';
import {
  ALL_SCENARIOS,
  answerStep,
  buildPlan,
  programPosition,
  startSession,
  selectSessionStory,
  publicItem,
  type AnswerPayload,
} from '@/lib/engine/session';
import { TOTAL_DAYS } from '@/lib/content/program';
import { TASK_BY_ID } from '@/lib/content/cognitive';
import { SKILL_LABELS } from '@/lib/engine/adaptive';
import { dueReviewTopics, reviewStatesFromSessions, reviewDayKeyFor } from '@/lib/review/topics';
import { YEAR, lessonOfDay } from '@/lib/content/year';
import { entitlementFor, mayStartLesson, paywallCopy } from '@/lib/access/entitlement';
import { CONSENT_VERSION, consentOutdated } from '@/lib/legal/consent';
import { recordFunnel } from '@/lib/events/funnel-store';

export const dynamic = 'force-dynamic';

async function sessionInfo(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'session', auth.parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  const plan = buildPlan(profile).map((p) =>
    p.type === 'task'
      ? {
          type: 'task' as const,
          title: TASK_BY_ID[p.taskId].title,
          skill: SKILL_LABELS[p.skill],
          skillId: p.skill,
        }
      : {
          type: 'scenario' as const,
          title: ALL_SCENARIOS[p.scenarioId].variants[profile.band].title,
          skill: ALL_SCENARIOS[p.scenarioId].skillLabel,
          skillId: 'soft',
        },
  );

  const pos = programPosition(profileId);
  /**
   * Занятие, к которому относится текущий день, и право его начать.
   *
   * Считается на сервере, а не на клиенте: иначе доступ можно было бы открыть
   * правкой ответа. `mayStart` отвечает только за **новое** занятие; начатая
   * сессия продолжается всегда.
   */
  const lesson = lessonOfDay(YEAR, pos.dayIndex);
  const entitlement = entitlementFor({
    lessonNumber: lesson?.number ?? 1,
    lead: profile.meetingLead,
    subscription: store.sub(profileId),
  });
  return NextResponse.json({
    plan,
    band: profile.band,
    consent: { required: consentOutdated(profile), version: CONSENT_VERSION },
    access: {
      lesson: lesson?.number ?? 1,
      lessonsTotal: YEAR.lessons.length,
      level: entitlement.level,
      free: entitlement.free,
      mayStart: mayStartLesson(entitlement),
      reason: entitlement.reason,
      paywallAfterLesson: entitlement.paywallAfterLesson,
    },
    program: {
      week: pos.week.week,
      weekTitle: pos.week.title,
      weekArt: weekArt(pos.week.week, pos.week.competency),
      weekSubtitle: pos.week.subtitle,
      day: pos.day.day,
      dayTheme: pos.day.theme,
      parentGoal: pos.day.parentGoal,
      completedDays: pos.state.completedDays,
      totalDays: TOTAL_DAYS,
      finished: pos.finished,
      // Повтор темы предлагается, только когда наступил срок и сегодня его ещё не было.
      reviewOff: pos.state.reviewOff === true,
      review: pos.state.reviewOff === true || pos.state.reviewDay === reviewDayKeyFor(profile) ? null
        : dueReviewTopics(reviewStatesFromSessions(store.sessions(profile.id), profile.band, Date.now(), pos.state.reviewStates ?? []), profile.band, Date.now(), 1)[0] ?? null,
      // Если тем несколько, показываем все подходящие: выбрать можно любую.
      reviewOptions: pos.state.reviewOff === true || pos.state.reviewDay === reviewDayKeyFor(profile) ? []
        : dueReviewTopics(reviewStatesFromSessions(store.sessions(profile.id), profile.band, Date.now(), pos.state.reviewStates ?? []), profile.band, Date.now(), 5),
    },
  });
}

async function sessionCommand(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'session', auth.parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as {
    action?: 'start' | 'answer' | 'select_story';
    profileId?: string;
    sessionId?: string;
    answer?: AnswerPayload;
    ms?: number;
    step?: number;
    repeat?: boolean;
    storyChoice?: boolean;
    journey?: boolean;
    /** Необязательный отдельный заход-повторение темы из пройденного. */
    review?: boolean;
  reviewTopicId?: string;
    cardId?: string;
  };

  // Журнал технических событий: пишется в той же транзакции, что и прогресс.
  // Явная копия методов: движок получает тот же store, но с постоянным журналом и владельцем.
  // Журнал пишется в той же транзакции, что и прогресс, и удаляется вместе с профилем.
  const journal = createStoreJournal(store, { persistOk: (owner, profile) => Boolean(ownedProfileForOwner(owner, profile)) });
  const context = { ...store, journal, ownerId: auth.parentId };

  if (body.action === 'start') {
    if (typeof body.profileId !== 'string' || !body.profileId || (body.repeat !== undefined && typeof body.repeat !== 'boolean') || (body.storyChoice !== undefined && typeof body.storyChoice !== 'boolean') || (body.journey !== undefined && typeof body.journey !== 'boolean') || (body.review !== undefined && typeof body.review !== 'boolean') || (body.reviewTopicId !== undefined && (typeof body.reviewTopicId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.reviewTopicId)))) return NextResponse.json({ error: 'invalid_start' }, { status: 400 });
    /*
     * Проверки доступа стоят до транзакции старта, но внутри той же ветки:
     * отказать нужно раньше, чем создастся сессия, иначе «закрытое» занятие
     * будет лежать в хранилище и его можно будет дописать ответом.
     *
     * Порядок: профиль → согласие → оплата. Согласие раньше оплаты, потому
     * что деньги можно вернуть, а обработку данных ребёнка — нет.
     */
    const profile = body.profileId ? ownedProfile(auth.parentId, body.profileId) : undefined;
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    if (consentOutdated(profile)) {
      return NextResponse.json({ error: 'consent_required', version: CONSENT_VERSION }, { status: 403 });
    }
    const lesson = lessonOfDay(YEAR, programPosition(profile.id).dayIndex);
    const entitlement = entitlementFor({ lessonNumber: lesson?.number ?? 1, lead: profile.meetingLead, subscription: store.sub(profile.id) });
    // Повтор пройденного занятия не закрывается: он не открывает нового
    // содержания и не должен наказывать за окончание оплаты.
    if (!body.repeat && !body.review && !mayStartLesson(entitlement)) {
      recordFunnel({ step: 'paywall_seen', ownerId: auth.parentId, lessonNumber: entitlement.lessonNumber, at: Date.now() });
      return NextResponse.json({ error: 'payment_required', ...paywallCopy(entitlement.reason), access: { lesson: entitlement.lessonNumber, level: entitlement.level } }, { status: 402 });
    }
    // «Первое занятие» — это первая сессия у этого ребёнка, а не первый клик
    // вообще: повтор и разбор темы не должны считаться активацией.
    const firstSession = !body.repeat && !body.review && store.sessions(profile.id).length === 0;
    return context.transaction(() => {
      const started = startSession(profile, Boolean(body.repeat), context, { storyChoice: body.storyChoice, journey: body.journey, review: body.review, reviewTopicId: body.reviewTopicId });
      if (firstSession) recordFunnel({ step: 'first_session', ownerId: auth.parentId, at: Date.now() });
      return NextResponse.json(started);
    });
  }

  if (body.action === 'select_story') {
    if (typeof body.sessionId !== 'string' || !body.sessionId || typeof body.cardId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.cardId)) return NextResponse.json({ error: 'invalid_story' }, { status: 400 });
    return context.transaction(() => {
      const session = store.getSession(body.sessionId!);
      if (!session || !ownedProfile(auth.parentId, session.profileId)) return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
      const result = selectSessionStory(body.sessionId!, body.cardId!, context);
      if ('error' in result) return NextResponse.json(result, { status: result.error === 'story_conflict' ? 409 : 400 });
      const selected = store.getSession(body.sessionId!);
      const profile = selected && ownedProfile(auth.parentId, selected.profileId);
      const rt = selected?.runtime;
      // Older clients keep their existing response contract. A v2 choice replaces the first item.
      return NextResponse.json(rt?.storyFlow?.version === 2 && profile ? { ...result, item: publicItem(rt.items[rt.index], profile.band), step: rt.index, steps: rt.items.length } : !rt && selected?.finishedAt ? { ...result, finished: true } : result);
    });
  }

  if (body.action === 'answer') {
    if (typeof body.sessionId !== 'string' || !body.sessionId) return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
    if (body.ms !== undefined && (typeof body.ms !== 'number' || !Number.isFinite(body.ms) || body.ms < 0)) return NextResponse.json({ error: 'invalid_duration' }, { status: 400 });
    const session = store.getSession(body.sessionId);
    if (!session || !ownedProfile(auth.parentId, session.profileId)) return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
    if (!Number.isInteger(body.step) || body.step! < 0) return NextResponse.json({ error: 'step_required' }, { status: 400 });
    const res = answerStep(body.sessionId, body.answer ?? {}, Number(body.ms) || 0, body.step!, context);
    if ('error' in res) return NextResponse.json(res, { status: ['step_conflict', 'story_selection_required', 'story_flow_conflict'].includes(res.error) ? 409 : res.error === 'invalid_answer' ? 400 : 404 });
    // Занятие доведено до конца — это второй шаг активации, отдельный от
    // старта. Первым шагом считаем только первый такой случай (дедуп в
    // хранилище воронки сам отбросит повторы).
    if (res.done === true) recordFunnel({ step: 'first_finished', ownerId: auth.parentId, at: Date.now() });
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}

/**
 * Метрики и логи только на двух самых нагруженных обработчиках: у остальных
 * маршрутов те же данные видны по rate limit и по 5xx. Расширять список стоит
 * тогда, когда появится реальный вопрос, на который метрика отвечает.
 */
export const GET = measured('session.info', sessionInfo);

/**
 * POST принимает контекст трассировки вторым аргументом: в Next обработчик
 * маршрута получает его вместе с запросом. Так `traceId` попадает в лог
 * ошибки, не читая ни тела, ни заголовков авторизации.
 */
export const POST = measured('session.command', sessionCommand, ctx => ({
  traceId: ctx?.traceId,
  route: 'session.command',
}));
