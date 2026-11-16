/**
 * Обезличенная исследовательская выгрузка (CSV, JSON и xAPI 1.0.3).
 *
 * Правила приватности:
 *  - Никогда не выгружаются `profileId`, `parentId`, имя ребёнка, почта или
 *    текст/номер выбранного варианта сценария (`choice`).
 *  - Связка строк одного участника во времени обеспечивается необратимым
 *    HMAC-псевдонимом `participant_hash`.
 */
import { createHash } from 'node:crypto';
import { store } from '../store.ts';
import { storeModeOf } from '../store-mode.ts';
import { openBridge } from '../postgres/state-backend.ts';
import { readAnalyticsSnapshotAsync } from '../postgres/async-pool.ts';
import {
  constructsForScenario,
  pseudonymizeId,
  researchStageForLesson,
} from './coding.ts';
import { SHOWCASE_ANCHORS } from '../year/lessons.ts';
import { listCodingSamples } from './coding-store.ts';
import { FQS_ITEMS } from './fqs.ts';
import { listFqsResponses } from './fqs-store.ts';
import type { AgeBand, Payment, Profile, ProgramState, Session, Subscription } from '../types.ts';
import type { Group, Membership } from '../teacher/access.ts';

export type ResearchDatasetKind = 'sessions' | 'showcases' | 'retention' | 'irr' | 'fqs';
export type ResearchExportFormat = 'csv' | 'json' | 'xapi';

export type AnalyticsSourceData = {
  profiles: Profile[];
  sessions: Session[];
  subs: Subscription[];
  programStates: ProgramState[];
  payments: Payment[];
  groups: Group[];
  memberships: Membership[];
  ledgerCount: number;
};

export async function loadAnalyticsSourceData(): Promise<AnalyticsSourceData> {
  const asyncSnap = await readAnalyticsSnapshotAsync();
  if (asyncSnap) {
    return {
      profiles: asyncSnap.profiles as unknown as Profile[],
      sessions: asyncSnap.sessions as unknown as Session[],
      subs: asyncSnap.subs as unknown as Subscription[],
      programStates: asyncSnap.programStates as unknown as ProgramState[],
      payments: asyncSnap.payments as unknown as Payment[],
      groups: asyncSnap.groups as unknown as Group[],
      memberships: asyncSnap.memberships as unknown as Membership[],
      ledgerCount: asyncSnap.ledgerCount,
    };
  }
  const db = store.all();
  let ledgerCount = 0;
  if (storeModeOf() === 'postgres') {
    try {
      const rows = openBridge().query('SELECT COUNT(*)::int AS count FROM gib.payment_ledger', []);
      ledgerCount = Number(rows[0]?.count ?? 0);
    } catch {
      ledgerCount = 0;
    }
  }
  return {
    profiles: db.profiles,
    sessions: db.sessions,
    subs: db.subs,
    programStates: db.programStates,
    payments: db.payments,
    groups: db.groups,
    memberships: db.memberships,
    ledgerCount,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Защита от CSV-инъекции формул и экранирование RFC 4180.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function rowsToCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const header = columns.map(csvCell).join(',');
  const lines = rows.map((row) => columns.map((col) => csvCell(row[col])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

function isoDate(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function durationBucket(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 120) return 'under_2m';
  if (seconds < 300) return '2_to_5m';
  if (seconds < 600) return '5_to_10m';
  return '10m_plus';
}

export function buildDatasetRows(
  kind: ResearchDatasetKind,
  data: AnalyticsSourceData,
  env: NodeJS.ProcessEnv = process.env,
): { columns: string[]; rows: Record<string, unknown>[] } {
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));
  const groupByProfile = new Map<string, Group>();
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  for (const m of data.memberships) {
    const g = groupById.get(m.groupId);
    if (g) groupByProfile.set(m.profileId, g);
  }

  if (kind === 'sessions') {
    const columns = [
      'participant_hash',
      'age_band',
      'mode',
      'completed',
      'is_review',
      'day_index',
      'week_number',
      'competency',
      'constructs',
      'tasks_count',
      'duration_bucket',
      'date_utc',
    ];
    const rows = data.sessions.map((s) => {
      const profile = profileById.get(s.profileId);
      const dayIndex = typeof s.runtime?.dayIndex === 'number' ? s.runtime.dayIndex + 1 : '';
      const weekNumber = typeof dayIndex === 'number' ? Math.ceil(dayIndex / 5) : '';
      const scenarioId = s.scenario?.scenarioId ?? '';
      const constructs = scenarioId ? constructsForScenario(scenarioId).join('|') : '';
      const mode = groupByProfile.has(s.profileId)
        ? 'group'
        : profile?.meetingLead === 'child'
          ? 'child_solo'
          : 'family';
      return {
        participant_hash: pseudonymizeId(s.profileId, env),
        age_band: profile?.band ?? '',
        mode,
        completed: Boolean(s.finishedAt),
        is_review: Boolean(s.review),
        day_index: dayIndex,
        week_number: weekNumber,
        competency: s.scenario?.competency ?? '',
        constructs,
        tasks_count: s.tasks?.length ?? 0,
        duration_bucket: durationBucket(s.seconds),
        date_utc: isoDate(s.startedAt),
      };
    });
    return { columns, rows };
  }

  if (kind === 'showcases') {
    const columns = [
      'participant_hash',
      'group_hash',
      'age_band',
      'lesson_number',
      'stage',
      'attended',
      'showcase_level',
      'showcase_anchor',
      'date',
    ];
    const rows: Record<string, unknown>[] = [];
    for (const ps of data.programStates) {
      const profile = profileById.get(ps.profileId);
      const group = groupByProfile.get(ps.profileId);
      for (const l of ps.lessons ?? []) {
        if (l.showcase === undefined && l.attended === undefined) continue;
        rows.push({
          participant_hash: pseudonymizeId(ps.profileId, env),
          group_hash: group ? pseudonymizeId(group.id, env) : '',
          age_band: profile?.band ?? '',
          lesson_number: l.lesson,
          stage: researchStageForLesson(l.lesson),
          attended: l.attended === undefined ? '' : l.attended,
          showcase_level: l.showcase === undefined ? '' : l.showcase,
          showcase_anchor: l.showcase !== undefined ? SHOWCASE_ANCHORS[l.showcase] : '',
          date: l.date,
        });
      }
    }
    return { columns, rows };
  }

  if (kind === 'retention') {
    const columns = [
      'participant_hash',
      'age_band',
      'mode',
      'completed_days',
      'completed_weeks',
      'sessions_completed',
      'lessons_attended',
      'showcases_recorded',
      'cohort_month',
    ];
    const progByProfile = new Map(data.programStates.map((ps) => [ps.profileId, ps]));
    const rows = data.profiles.map((p) => {
      const ps = progByProfile.get(p.id);
      const completedSessions = data.sessions.filter(
        (s) => s.profileId === p.id && Boolean(s.finishedAt) && !s.review,
      ).length;
      const lessonsAttended = (ps?.lessons ?? []).filter((l) => l.attended === true).length;
      const showcasesRecorded = (ps?.lessons ?? []).filter((l) => l.showcase !== undefined).length;
      const completedDays = ps?.completedDays ?? 0;
      const mode = groupByProfile.has(p.id) ? 'group' : p.meetingLead === 'child' ? 'child_solo' : 'family';
      return {
        participant_hash: pseudonymizeId(p.id, env),
        age_band: p.band,
        mode,
        completed_days: completedDays,
        completed_weeks: Math.floor(completedDays / 5),
        sessions_completed: completedSessions,
        lessons_attended: lessonsAttended,
        showcases_recorded: showcasesRecorded,
        cohort_month: isoDate(p.createdAt).slice(0, 7),
      };
    });
    return { columns, rows };
  }

  if (kind === 'fqs') {
    const fqs = listFqsResponses();
    const itemCols = FQS_ITEMS.map((i) => i.id);
    const columns = [
      'response_id',
      'participant_hash',
      'age_band',
      'stage',
      'lesson',
      'companionship',
      'conflict',
      'help',
      'security',
      'closeness',
      'composite_mean',
      ...itemCols,
      'created_date',
    ];
    const rows = fqs.map((r) => {
      const base: Record<string, unknown> = {
        response_id: r.responseId,
        participant_hash: r.participantHash,
        age_band: r.ageBand,
        stage: r.stage,
        lesson: r.lesson ?? '',
        companionship: r.subscales.companionship,
        conflict: r.subscales.conflict,
        help: r.subscales.help,
        security: r.subscales.security,
        closeness: r.subscales.closeness,
        composite_mean: r.compositeMean,
        created_date: isoDate(r.createdAt),
      };
      for (const col of itemCols) {
        base[col] = r.items[col] ?? '';
      }
      return base;
    });
    return { columns, rows };
  }

  // dataset === 'irr'
  const columns = [
    'sample_id',
    'participant_hash',
    'age_band',
    'lesson_number',
    'stage',
    'rater_a_id',
    'rater_a_score',
    'rater_b_id',
    'rater_b_score',
    'exact_match',
  ];
  const samples = listCodingSamples();
  const rows = samples.map((s) => ({
    sample_id: s.sampleId,
    participant_hash: s.participantHash,
    age_band: s.ageBand,
    lesson_number: s.lesson,
    stage: s.stage,
    rater_a_id: s.raterA ? pseudonymizeId(s.raterA.raterId, env) : '',
    rater_a_score: s.raterA?.score ?? '',
    rater_b_id: s.raterB ? pseudonymizeId(s.raterB.raterId, env) : '',
    rater_b_score: s.raterB?.score ?? '',
    exact_match:
      s.raterA && s.raterB ? s.raterA.score === s.raterB.score : '',
  }));
  return { columns, rows };
}

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Экспорт в формат ADL xAPI 1.0.3 (массив псевдонимизированных xAPI-утверждений)
 * для загрузки во внешнюю исследовательскую LRS университета.
 */
export function buildXapiStatements(
  kind: ResearchDatasetKind,
  data: AnalyticsSourceData,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown>[] {
  const homePage = 'https://gib.research.local';
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));

  if (kind === 'fqs') {
    return listFqsResponses().map((r) => ({
      id: deterministicUuid(`fqs:${r.participantHash}:${r.responseId}`),
      version: '1.0.3',
      actor: {
        objectType: 'Agent',
        account: { homePage, name: r.participantHash },
      },
      verb: {
        id: 'http://adlnet.gov/expapi/verbs/responded',
        display: { 'ru-RU': 'заполнил исследовательский бланк качества дружбы (FQS)' },
      },
      object: {
        objectType: 'Activity',
        id: `${homePage}/activities/fqs/${r.stage}`,
        definition: {
          type: 'http://adlnet.gov/expapi/activities/assessment',
          name: { 'ru-RU': `Опросник FQS · срез ${r.stage}` },
        },
      },
      result: {
        score: { min: 1, max: 5, raw: r.compositeMean },
        extensions: {
          [`${homePage}/ext/fqs_subscales`]: r.subscales,
          [`${homePage}/ext/stage`]: r.stage,
        },
      },
      context: {
        extensions: {
          [`${homePage}/ext/age_band`]: r.ageBand,
          [`${homePage}/ext/lesson`]: r.lesson ?? null,
        },
      },
      timestamp: new Date(r.createdAt).toISOString(),
    }));
  }

  if (kind === 'showcases') {
    const statements: Record<string, unknown>[] = [];
    for (const ps of data.programStates) {
      const profile = profileById.get(ps.profileId);
      const actorHash = pseudonymizeId(ps.profileId, env);
      for (const l of ps.lessons ?? []) {
        if (l.showcase === undefined) continue;
        statements.push({
          id: deterministicUuid(`showcase:${actorHash}:${l.lesson}:${l.date}`),
          version: '1.0.3',
          actor: {
            objectType: 'Agent',
            account: { homePage, name: actorHash },
          },
          verb: {
            id: 'http://adlnet.gov/expapi/verbs/experienced',
            display: { 'ru-RU': 'участвовал в очном показе' },
          },
          object: {
            objectType: 'Activity',
            id: `${homePage}/activities/showcase/lesson-${l.lesson}`,
            definition: {
              type: 'http://adlnet.gov/expapi/activities/performance',
              name: { 'ru-RU': `Очный показ · встреча ${l.lesson}` },
            },
          },
          result: {
            extensions: {
              [`${homePage}/ext/showcase_level`]: l.showcase,
              [`${homePage}/ext/stage`]: researchStageForLesson(l.lesson),
            },
          },
          context: {
            extensions: {
              [`${homePage}/ext/age_band`]: (profile?.band ?? '8-10') as AgeBand,
            },
          },
          timestamp: `${l.date}T12:00:00.000Z`,
        });
      }
    }
    return statements;
  }

  // По умолчанию — завершённые сценарные сессии с конструктами.
  return data.sessions
    .filter((s) => Boolean(s.finishedAt))
    .map((s) => {
      const profile = profileById.get(s.profileId);
      const actorHash = pseudonymizeId(s.profileId, env);
      const scenarioId = s.scenario?.scenarioId ?? 'practice';
      const constructs = scenarioId ? constructsForScenario(scenarioId) : [];
      return {
        id: deterministicUuid(`session:${actorHash}:${s.id}`),
        version: '1.0.3',
        actor: {
          objectType: 'Agent',
          account: { homePage, name: actorHash },
        },
        verb: {
          id: 'http://adlnet.gov/expapi/verbs/completed',
          display: { 'ru-RU': 'завершил занятие' },
        },
        object: {
          objectType: 'Activity',
          id: `${homePage}/activities/session/${encodeURIComponent(scenarioId)}`,
          definition: {
            type: 'http://adlnet.gov/expapi/activities/simulation',
            name: { 'ru-RU': `Сценарий ${scenarioId}` },
          },
        },
        result: {
          completion: true,
          duration: `PT${Math.max(0, Math.round(s.seconds || 0))}S`,
        },
        context: {
          extensions: {
            [`${homePage}/ext/age_band`]: profile?.band ?? '',
            [`${homePage}/ext/competency`]: s.scenario?.competency ?? '',
            [`${homePage}/ext/constructs`]: constructs,
            [`${homePage}/ext/is_review`]: Boolean(s.review),
          },
        },
        timestamp: new Date(s.finishedAt ?? s.startedAt).toISOString(),
      };
    });
}
