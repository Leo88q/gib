import { weekArt } from '@/lib/art-paths';
import { dueReviewTopics, reviewStatesFromSessions, reviewDayKeyFor } from '@/lib/review/topics';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { readJsonObject } from '@/lib/http-body';
import { programPosition } from '@/lib/engine/session';
import { PROGRAM, TOTAL_DAYS } from '@/lib/content/program';
import { SCENARIO_BY_ID } from '@/lib/content/program';

export const dynamic = 'force-dynamic';

/** Взрослый выключает и включает предложения повтора. Прогресс и сроки не меняются. */
export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'program-write', auth.parentId), 40)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (Object.keys(body).some(k => !['profileId', 'reviewOff'].includes(k))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (typeof body.profileId !== 'string' || !body.profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (typeof body.reviewOff !== 'boolean') return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, body.profileId as string);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const state = store.programState(profile.id);
    store.setProgramState({ ...state, reviewOff: body.reviewOff as boolean });
    return NextResponse.json({
      reviewOff: body.reviewOff,
      notice: body.reviewOff
        ? 'Предложения повтора выключены. Новые дни и прогресс это не меняет; включить можно в любой момент.'
        : 'Предложения повтора включены: тема появляется, когда придёт срок, и её можно не брать.',
    });
  });
}

/** Полная 12-недельная программа + прогресс профиля — для кабинета родителя. */
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'program', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  const profile = ownedProfile(auth.parentId, profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  const pos = programPosition(profileId);

  const weeks = PROGRAM.map((w) => ({
    week: w.week,
    title: w.title,
    subtitle: w.subtitle,
    competency: w.competency,
    parentNote: w.parentNote,
    homeIdeas: w.homeIdeas,
    weekQuestion: w.weekQuestion,
    art: weekArt(w.week, w.competency),
    days: w.days.map((d) => {
      const sc = SCENARIO_BY_ID[d.scenarioId];
      const globalIndex = (w.week - 1) * 5 + (d.day - 1);
      return {
        day: d.day,
        // Сквозной номер дня нужен, чтобы посчитать прогресс по годовой сетке
        // (36 занятий): занятие — это набор дней, а не номер недели.
        index: globalIndex,
        theme: d.theme,
        title: sc ? sc.variants[profile.band].title : '',
        focus: d.focus,
        parentGoal: d.parentGoal,
        scenarioId: d.scenarioId,
        done: globalIndex < pos.state.completedDays,
        current: globalIndex === pos.state.completedDays,
      };
    }),
  }));

  // Повтор в срок: предлагается, но не навязывается. Если тем нет — поля review нет.
  const reviewStates = reviewStatesFromSessions(store.sessions(profile.id), profile.band, Date.now(), pos.state.reviewStates ?? []);
  const reviewOff = pos.state.reviewOff === true;
  const review = reviewOff || pos.state.reviewDay === reviewDayKeyFor(profile) ? null : dueReviewTopics(reviewStates, profile.band, Date.now(), 1)[0] ?? null;

  // Когда было последнее завершённое занятие: нужно только для настроения питомца.
  const lastFinished = store.sessions(profile.id).reduce((max, s) => (typeof s.finishedAt === 'number' && s.finishedAt > max ? s.finishedAt : max), 0);

  return NextResponse.json({
    review: review ? { topicId: review.topicId, title: review.title } : null,
    reviewOff,
    lastFinishedAt: lastFinished || null,
    progress: {
      completedDays: pos.state.completedDays,
      totalDays: TOTAL_DAYS,
      finished: pos.finished,
      currentWeek: pos.week.week,
      currentDay: pos.day.day,
      band: profile.band,
    },
    weeks,
  });
}
