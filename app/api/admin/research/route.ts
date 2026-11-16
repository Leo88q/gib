import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { checkAdminToken } from '@/lib/admin/auth';
import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import {
  buildSupervisorReport,
  CODING_PROTOCOL,
  isShowcaseLessonNumber,
  pseudonymizeId,
  researchStageForLesson,
  type ShowcaseCodingSample,
} from '@/lib/research/coding';
import { getCodingSample, listCodingSamples, saveCodingSample } from '@/lib/research/coding-store';
import { FQS_PROTOCOL, parseAndScoreFqsItems, type FqsResponseRecord } from '@/lib/research/fqs';
import { listFqsResponses, saveFqsResponse } from '@/lib/research/fqs-store';
import { loadAnalyticsSourceData } from '@/lib/research/export';
import type { AgeBand } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/research
 * Отдаёт протокол кодирования, сводный отчёт для научного руководителя ВУЗа
 * и список образцов показов. Если передан `?blindSlot=rater_a|rater_b`,
 * оценка второго оценщика скрывается до тех пор, пока оба не завершили ввод.
 */
export async function GET(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;
  if (!rateLimit(clientKey(req, 'admin-research'), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const blindSlot = new URL(req.url).searchParams.get('blindSlot');
  const data = await loadAnalyticsSourceData();
  const codings = listCodingSamples();
  const fqsResponses = listFqsResponses();

  const report = buildSupervisorReport({
    profiles: data.profiles,
    sessions: data.sessions,
    programStates: data.programStates,
    groupsCount: data.groups.length,
    codings,
    fqsResponses,
  });

  const publicSamples = codings.map((s) => {
    const bothDone = Boolean(s.raterA && s.raterB);
    const hideA = !bothDone && blindSlot === 'rater_b';
    const hideB = !bothDone && blindSlot === 'rater_a';
    return {
      sampleId: s.sampleId,
      participantHash: s.participantHash,
      ageBand: s.ageBand,
      lesson: s.lesson,
      stage: s.stage,
      raterA: s.raterA ? (hideA ? { submitted: true } : { submitted: true, score: s.raterA.score, codedAt: s.raterA.codedAt }) : null,
      raterB: s.raterB ? (hideB ? { submitted: true } : { submitted: true, score: s.raterB.score, codedAt: s.raterB.codedAt }) : null,
      paired: bothDone,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });

  // Доступные для создания образцов профили с действующим согласием на съёмку (только псевдонимы + линейка).
  const consentedCandidates = data.profiles
    .filter((p) => p.videoConsent?.granted)
    .map((p) => ({
      profileId: p.id,
      participantHash: pseudonymizeId(p.id),
      ageBand: p.band,
    }));

  const publicFqs = fqsResponses.slice(0, 50).map((r) => ({
    responseId: r.responseId,
    participantHash: r.participantHash,
    ageBand: r.ageBand,
    stage: r.stage,
    lesson: r.lesson ?? null,
    subscales: r.subscales,
    compositeMean: r.compositeMean,
    createdAt: r.createdAt,
  }));

  return NextResponse.json(
    {
      protocol: CODING_PROTOCOL,
      fqsProtocol: FQS_PROTOCOL,
      report,
      samples: publicSamples,
      fqsResponses: publicFqs,
      consentedCandidates,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * POST /api/admin/research
 *  - `{ action: 'create_sample', profileId?, anonymousKey?, ageBand?, lesson }`
 *  - `{ action: 'submit_rating', sampleId, slot: 'rater_a' | 'rater_b', raterId, score: 0 | 1 | 2 }`
 */
export async function POST(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;
  if (!rateLimit(clientKey(req, 'admin-research-write'), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  const now = Date.now();

  if (body.action === 'create_sample') {
    const lesson = Number(body.lesson);
    if (!Number.isInteger(lesson) || !isShowcaseLessonNumber(lesson)) {
      return NextResponse.json({ error: 'invalid_showcase_lesson' }, { status: 400 });
    }

    let profileId: string | null = null;
    let participantHash = '';
    let ageBand: AgeBand = '8-10';

    if (typeof body.profileId === 'string' && body.profileId.trim()) {
      const profile = store.profile(body.profileId.trim());
      if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
      if (!profile.videoConsent?.granted) {
        return NextResponse.json({ error: 'video_consent_required' }, { status: 403 });
      }
      profileId = profile.id;
      participantHash = pseudonymizeId(profile.id);
      ageBand = profile.band;
    } else if (typeof body.anonymousKey === 'string' && body.anonymousKey.trim().length >= 3) {
      if (!['5-7', '8-10', '11-13'].includes(String(body.ageBand))) {
        return NextResponse.json({ error: 'invalid_age_band' }, { status: 400 });
      }
      participantHash = pseudonymizeId(`anon:${body.anonymousKey.trim()}`);
      ageBand = body.ageBand as AgeBand;
    } else {
      return NextResponse.json({ error: 'subject_required' }, { status: 400 });
    }

    const sample: ShowcaseCodingSample = {
      sampleId: `smp_${randomUUID().slice(0, 12)}`,
      profileId,
      participantHash,
      ageBand,
      lesson,
      stage: researchStageForLesson(lesson),
      raterA: null,
      raterB: null,
      createdAt: now,
      updatedAt: now,
    };
    saveCodingSample(sample);
    return NextResponse.json({
      ok: true,
      sample: {
        sampleId: sample.sampleId,
        participantHash: sample.participantHash,
        ageBand: sample.ageBand,
        lesson: sample.lesson,
        stage: sample.stage,
      },
    });
  }

  if (body.action === 'submit_rating') {
    const sampleId = typeof body.sampleId === 'string' ? body.sampleId.trim() : '';
    const slot = body.slot;
    const raterId = typeof body.raterId === 'string' ? body.raterId.trim() : '';
    const score = body.score;

    if (!sampleId || (slot !== 'rater_a' && slot !== 'rater_b')) {
      return NextResponse.json({ error: 'invalid_slot' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(raterId)) {
      return NextResponse.json({ error: 'invalid_rater_id' }, { status: 400 });
    }
    if (score !== 0 && score !== 1 && score !== 2) {
      return NextResponse.json({ error: 'invalid_score' }, { status: 400 });
    }

    const existing = getCodingSample(sampleId);
    if (!existing) return NextResponse.json({ error: 'sample_not_found' }, { status: 404 });

    if (existing.profileId) {
      const profile = store.profile(existing.profileId);
      if (!profile?.videoConsent?.granted) {
        return NextResponse.json({ error: 'video_consent_revoked' }, { status: 403 });
      }
    }

    if (slot === 'rater_a' && existing.raterB?.raterId === raterId) {
      return NextResponse.json({ error: 'same_rater_conflict' }, { status: 409 });
    }
    if (slot === 'rater_b' && existing.raterA?.raterId === raterId) {
      return NextResponse.json({ error: 'same_rater_conflict' }, { status: 409 });
    }

    const updated: ShowcaseCodingSample = {
      ...existing,
      raterA: slot === 'rater_a' ? { raterId, score, codedAt: now } : existing.raterA,
      raterB: slot === 'rater_b' ? { raterId, score, codedAt: now } : existing.raterB,
      updatedAt: now,
    };
    saveCodingSample(updated);

    const paired = Boolean(updated.raterA && updated.raterB);
    return NextResponse.json({
      ok: true,
      paired,
      sampleId: updated.sampleId,
    });
  }

  if (body.action === 'submit_fqs') {
    const stage = body.stage;
    if (stage !== 'entry' && stage !== 'mid' && stage !== 'final') {
      return NextResponse.json({ error: 'invalid_stage' }, { status: 400 });
    }
    const rawLesson = body.lesson;
    let lesson: number | null = null;
    if (rawLesson !== undefined && rawLesson !== null && rawLesson !== '') {
      const parsedLesson = Number(rawLesson);
      if (!Number.isInteger(parsedLesson) || parsedLesson < 1 || parsedLesson > 36) {
        return NextResponse.json({ error: 'invalid_lesson' }, { status: 400 });
      }
      lesson = parsedLesson;
    }

    let profileId: string | null = null;
    let participantHash = '';
    let ageBand: AgeBand = '8-10';

    if (typeof body.profileId === 'string' && body.profileId.trim()) {
      const profile = store.profile(body.profileId.trim());
      if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
      if (!profile.videoConsent?.granted) {
        return NextResponse.json({ error: 'research_consent_required' }, { status: 403 });
      }
      profileId = profile.id;
      participantHash = pseudonymizeId(profile.id);
      ageBand = profile.band;
    } else if (typeof body.anonymousKey === 'string' && body.anonymousKey.trim().length >= 3) {
      const cleanKey = body.anonymousKey.trim();
      if (cleanKey.length > 80 || !/^[a-zA-Z0-9._-]+$/.test(cleanKey)) {
        return NextResponse.json({ error: 'invalid_anonymous_key' }, { status: 400 });
      }
      if (body.ageBand !== '5-7' && body.ageBand !== '8-10' && body.ageBand !== '11-13') {
        return NextResponse.json({ error: 'invalid_age_band' }, { status: 400 });
      }
      participantHash = pseudonymizeId(`anon:${cleanKey}`);
      ageBand = body.ageBand;
    } else {
      return NextResponse.json({ error: 'participant_required' }, { status: 400 });
    }

    if (!body.items || typeof body.items !== 'object' || Array.isArray(body.items)) {
      return NextResponse.json({ error: 'items_required' }, { status: 400 });
    }
    const scored = parseAndScoreFqsItems(body.items as Record<string, unknown>);
    if (!scored.ok) {
      return NextResponse.json({ error: scored.error }, { status: 400 });
    }

    const record: FqsResponseRecord = {
      responseId: `fqs_${randomUUID().slice(0, 12)}`,
      profileId,
      participantHash,
      ageBand,
      stage,
      lesson,
      items: scored.items,
      subscales: scored.subscales,
      compositeMean: scored.compositeMean,
      createdAt: now,
    };
    saveFqsResponse(record);

    return NextResponse.json(
      {
        ok: true,
        response: {
          responseId: record.responseId,
          participantHash: record.participantHash,
          ageBand: record.ageBand,
          stage: record.stage,
          lesson: record.lesson,
          subscales: record.subscales,
          compositeMean: record.compositeMean,
          createdAt: record.createdAt,
        },
      },
      { status: 201 },
    );
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
