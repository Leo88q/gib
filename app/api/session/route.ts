import { weekArt } from '@/lib/art-paths';
import { readJsonObject } from '@/lib/http-body';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
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

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
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
  return NextResponse.json({
    plan,
    band: profile.band,
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
    },
  });
}

export async function POST(req: Request) {
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
    cardId?: string;
  };

  // Журнал технических событий: пишется в той же транзакции, что и прогресс.
  // Явная копия методов: движок получает тот же store, но с постоянным журналом и владельцем.
  // Журнал пишется в той же транзакции, что и прогресс, и удаляется вместе с профилем.
  const journal = createStoreJournal(store, { persistOk: (owner, profile) => Boolean(ownedProfileForOwner(owner, profile)) });
  const context = { ...store, journal, ownerId: auth.parentId };

  if (body.action === 'start') {
    if (typeof body.profileId !== 'string' || !body.profileId || (body.repeat !== undefined && typeof body.repeat !== 'boolean') || (body.storyChoice !== undefined && typeof body.storyChoice !== 'boolean') || (body.journey !== undefined && typeof body.journey !== 'boolean')) return NextResponse.json({ error: 'invalid_start' }, { status: 400 });
    return context.transaction(() => {
      const profile = body.profileId ? ownedProfile(auth.parentId, body.profileId) : undefined;
      if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
      return NextResponse.json(startSession(profile, Boolean(body.repeat), context, { storyChoice: body.storyChoice, journey: body.journey }));
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
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
