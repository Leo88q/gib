/**
 * Модуль двойного независимого кодирования показов и расчёта надёжности
 * оценщиков (Inter-Rater Reliability: κ Коэна, взвешенная κ_w и AC1 Гвета),
 * а также агрегированный отчёт для научного руководителя ВУЗа.
 *
 * Ключевые правила продукта:
 *  1. Шкала 0 · 1 · 2 фиксирует только факт выхода на показ, а не качество
 *     игры или «правильность» ребёнка (якоря берутся из `SHOWCASE_ANCHORS`).
 *  2. Кодирование видеозаписи допускается только при наличии отдельного
 *     действующего согласия законного представителя (`videoConsent.granted`).
 *  3. Два оценщика (`rater_a` и `rater_b`) должны иметь разные идентификаторы
 *     и вносят оценки независимо (слепое кодирование).
 */
import { createHmac } from 'node:crypto';
import { SKILLS_CATALOG } from '../content/skills-catalog.ts';
import { STORY_SKILLS } from '../content/story-skills.ts';
import { YEAR } from '../content/year/index.ts';
import { SHOWCASE_ANCHORS, type ShowcaseLevel } from '../year/lessons.ts';
import type { AgeBand } from '../types.ts';

export const VIDEO_CONSENT_VERSION = '2026-11-16';

export type ResearchStage = 'entry' | 'mid' | 'final';

export type RaterObservation = {
  raterId: string;
  score: ShowcaseLevel;
  codedAt: number;
};

export type ShowcaseCodingSample = {
  sampleId: string;
  /** Необязательная внутренняя ссылка для отзыва согласия; наружу не экспортируется. */
  profileId?: string | null;
  participantHash: string;
  ageBand: AgeBand;
  lesson: number;
  stage: ResearchStage;
  raterA?: RaterObservation | null;
  raterB?: RaterObservation | null;
  createdAt: number;
  updatedAt: number;
};

export const CODING_PROTOCOL = {
  version: '2026-11-16',
  scale: [0, 1, 2] as const,
  anchors: SHOWCASE_ANCHORS,
  showcaseLessons: YEAR.lessons.filter((l) => l.isShowcase).map((l) => ({
    lesson: l.number,
    title: l.title,
    unit: l.unit,
    stage: researchStageForLesson(l.number),
  })),
  blindingRule: 'Два независимых оценщика (A и B) кодируют запись независимо, не видя оценку второго до завершения пары.',
  thresholds: {
    minPairedSamples: 10,
    cohenKappaAcceptable: 0.7,
    gwetAc1Acceptable: 0.75,
  },
} as const;

export function researchStageForLesson(lessonNumber: number): ResearchStage {
  if (lessonNumber <= 12) return 'entry';
  if (lessonNumber <= 24) return 'mid';
  return 'final';
}

export function isShowcaseLessonNumber(lessonNumber: number): boolean {
  return YEAR.lessons.some((l) => l.number === lessonNumber && l.isShowcase);
}

/** Псевдонимизация идентификатора участника или группы через HMAC-SHA256. */
export function pseudonymizeId(rawId: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.GIB_SESSION_SECRET || env.GIB_ADMIN_TOKEN || 'gib-research-default-salt-v1';
  return createHmac('sha256', secret).update(rawId).digest('hex').slice(0, 12);
}

/** Шесть исследовательских конструктов (совпадают с `docs/research-construct-map.md`). */
const BY_COMPETENCY: Record<string, readonly string[]> = {
  self_awareness_emotions: ['self_awareness'],
  empathy: ['empathy'],
  self_regulation: ['self_regulation'],
};

const COMMUNICATION = new Set([
  'ask_help', 'offer_help', 'accept_refusal', 'say_no', 'apologize', 'agree_rules', 'handle_conflict',
]);
const PLANNING = new Set(['plan_steps', 'change_plan', 'order_steps', 'first_things_first', 'rebuild_plan']);
const TEAMWORK = new Set(['join_group', 'take_role', 'support_group']);
const PERFORMANCE = new Set(['show_idea', 'show_work']);

export const CONSTRUCT_LABELS: Record<string, string> = {
  self_awareness_emotions: 'Самосознание и эмоции',
  empathy: 'Эмпатия',
  self_regulation: 'Саморегуляция и планирование',
  communication: 'Коммуникация и договорённость',
  teamwork: 'Командная работа',
  performance_confidence: 'Уверенность в выступлении',
};

export function buildSkillConstructMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of SKILLS_CATALOG) {
    for (const [construct, comps] of Object.entries(BY_COMPETENCY)) {
      if (comps.includes(skill.competency)) map.set(skill.id, construct);
    }
    if (COMMUNICATION.has(skill.id)) map.set(skill.id, 'communication');
    if (PLANNING.has(skill.id)) map.set(skill.id, 'self_regulation');
    if (TEAMWORK.has(skill.id)) map.set(skill.id, 'teamwork');
    if (PERFORMANCE.has(skill.id)) map.set(skill.id, 'performance_confidence');
  }
  return map;
}

export function constructsForScenario(scenarioId: string): string[] {
  const cleanId = scenarioId.replace(/^scenario:/, '');
  const skills = STORY_SKILLS[cleanId]?.skills ?? [];
  const skillMap = buildSkillConstructMap();
  const out = new Set<string>();
  for (const skillId of skills) {
    const construct = skillMap.get(skillId);
    if (construct) out.add(construct);
  }
  return [...out];
}

export type ReliabilityMetrics = {
  pairedCount: number;
  pendingCount: number;
  observedAgreement: number | null;
  cohenKappa: number | null;
  weightedKappa: number | null;
  gwetAc1: number | null;
  confusionMatrix: [[number, number, number], [number, number, number], [number, number, number]];
  verdict: 'insufficient_data' | 'below_threshold' | 'acceptable' | 'strong';
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Вычисляет согласованность двух независимых оценщиков по шкале 0 · 1 · 2:
 *  - долю совпадений P_o;
 *  - невзвешенную κ Коэна;
 *  - линейно взвешенную κ_w Коэна (для порядковой шкалы 0 < 1 < 2);
 *  - коэффициент AC1 Гвета (устойчив к перекосу базовых частот — «парадоксу каппы»).
 */
export function computeInterRaterReliability(samples: readonly ShowcaseCodingSample[]): ReliabilityMetrics {
  const matrix: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let pairedCount = 0;
  let pendingCount = 0;

  for (const s of samples) {
    const a = s.raterA?.score;
    const b = s.raterB?.score;
    if ((a === 0 || a === 1 || a === 2) && (b === 0 || b === 1 || b === 2)) {
      matrix[a][b] += 1;
      pairedCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  if (pairedCount === 0) {
    return {
      pairedCount: 0,
      pendingCount,
      observedAgreement: null,
      cohenKappa: null,
      weightedKappa: null,
      gwetAc1: null,
      confusionMatrix: matrix,
      verdict: 'insufficient_data',
    };
  }

  const n = pairedCount;
  const rowSums = [0, 1, 2].map((i) => matrix[i][0] + matrix[i][1] + matrix[i][2]);
  const colSums = [0, 1, 2].map((j) => matrix[0][j] + matrix[1][j] + matrix[2][j]);

  const po = (matrix[0][0] + matrix[1][1] + matrix[2][2]) / n;

  // Невзвешенная κ Коэна
  const peKappa = [0, 1, 2].reduce((acc, k) => acc + (rowSums[k] / n) * (colSums[k] / n), 0);
  const cohenKappa = peKappa >= 1 ? (po >= 1 ? 1 : 0) : (po - peKappa) / (1 - peKappa);

  // Линейно взвешенная κ_w для порядковой шкалы 0, 1, 2: w_ij = 1 - |i - j| / 2
  let poWeighted = 0;
  let peWeighted = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const w = 1 - Math.abs(i - j) / 2;
      poWeighted += w * (matrix[i][j] / n);
      peWeighted += w * ((rowSums[i] / n) * (colSums[j] / n));
    }
  }
  const weightedKappa = peWeighted >= 1 ? (poWeighted >= 1 ? 1 : 0) : (poWeighted - peWeighted) / (1 - peWeighted);

  // AC1 Гвета: p_k = ((rowSums[k] + colSums[k]) / (2n)), P_e(AC1) = (1 / (K - 1)) * sum p_k * (1 - p_k)
  const peAc1 =
    (1 / 2) *
    [0, 1, 2].reduce((acc, k) => {
      const pk = (rowSums[k] + colSums[k]) / (2 * n);
      return acc + pk * (1 - pk);
    }, 0);
  const gwetAc1 = peAc1 >= 1 ? (po >= 1 ? 1 : 0) : (po - peAc1) / (1 - peAc1);

  let verdict: ReliabilityMetrics['verdict'] = 'below_threshold';
  if (n < CODING_PROTOCOL.thresholds.minPairedSamples) {
    verdict = 'insufficient_data';
  } else if (cohenKappa >= 0.8 && gwetAc1 >= 0.85) {
    verdict = 'strong';
  } else if (
    cohenKappa >= CODING_PROTOCOL.thresholds.cohenKappaAcceptable ||
    gwetAc1 >= CODING_PROTOCOL.thresholds.gwetAc1Acceptable
  ) {
    verdict = 'acceptable';
  }

  return {
    pairedCount,
    pendingCount,
    observedAgreement: round4(po),
    cohenKappa: round4(cohenKappa),
    weightedKappa: round4(weightedKappa),
    gwetAc1: round4(gwetAc1),
    confusionMatrix: matrix,
    verdict,
  };
}

export type SupervisorReport = {
  generatedAt: number;
  protocolVersion: string;
  sample: {
    participantsTotal: number;
    byAgeBand: Record<AgeBand, number>;
    videoConsentGranted: number;
    completedSessionsTotal: number;
    activeGroups: number;
  };
  constructCoverage: {
    skillsTotal: number;
    skillsMapped: number;
    byConstruct: { id: string; label: string; skillsCount: number }[];
  };
  stageDynamics: Record<
    ResearchStage,
    { observations: number; level0: number; level1: number; level2: number }
  >;
  reliability: ReliabilityMetrics;
  limitations: readonly string[];
};

export function buildSupervisorReport(params: {
  profiles: readonly { id: string; band: AgeBand; videoConsent?: { granted?: boolean } }[];
  sessions: readonly { finishedAt?: number; review?: unknown }[];
  programStates: readonly { lessons?: readonly { lesson: number; showcase?: ShowcaseLevel }[] }[];
  groupsCount: number;
  codings: readonly ShowcaseCodingSample[];
  now?: number;
}): SupervisorReport {
  const byAgeBand: Record<AgeBand, number> = { '5-7': 0, '8-10': 0, '11-13': 0 };
  let videoConsentGranted = 0;
  for (const p of params.profiles) {
    if (p.band in byAgeBand) byAgeBand[p.band] += 1;
    if (p.videoConsent?.granted) videoConsentGranted += 1;
  }

  const completedSessionsTotal = params.sessions.filter((s) => Boolean(s.finishedAt) && !s.review).length;

  const skillMap = buildSkillConstructMap();
  const countsByConstruct = new Map<string, number>();
  for (const construct of skillMap.values()) {
    countsByConstruct.set(construct, (countsByConstruct.get(construct) ?? 0) + 1);
  }

  const stageDynamics: SupervisorReport['stageDynamics'] = {
    entry: { observations: 0, level0: 0, level1: 0, level2: 0 },
    mid: { observations: 0, level0: 0, level1: 0, level2: 0 },
    final: { observations: 0, level0: 0, level1: 0, level2: 0 },
  };

  for (const ps of params.programStates) {
    for (const l of ps.lessons ?? []) {
      if (l.showcase === 0 || l.showcase === 1 || l.showcase === 2) {
        const st = researchStageForLesson(l.lesson);
        stageDynamics[st].observations += 1;
        if (l.showcase === 0) stageDynamics[st].level0 += 1;
        if (l.showcase === 1) stageDynamics[st].level1 += 1;
        if (l.showcase === 2) stageDynamics[st].level2 += 1;
      }
    }
  }

  return {
    generatedAt: params.now ?? Date.now(),
    protocolVersion: CODING_PROTOCOL.version,
    sample: {
      participantsTotal: params.profiles.length,
      byAgeBand,
      videoConsentGranted,
      completedSessionsTotal,
      activeGroups: params.groupsCount,
    },
    constructCoverage: {
      skillsTotal: SKILLS_CATALOG.length,
      skillsMapped: skillMap.size,
      byConstruct: Object.entries(CONSTRUCT_LABELS).map(([id, label]) => ({
        id,
        label,
        skillsCount: countsByConstruct.get(id) ?? 0,
      })),
    },
    stageDynamics,
    reliability: computeInterRaterReliability(params.codings),
    limitations: [
      'Внутренние отметки педагогов отражают вовлечённость и факт выхода на показ, но не заменяют внешнюю контрольную группу.',
      'Сценарные выборы в симуляторе намеренно не имеют правильного ответа и не интерпретируются как оценка личности ребёнка.',
      'Вывод о надёжности кодирования правомерен при не менее чем 10 парных независимых наблюдениях и κ ≥ 0.70 (AC1 ≥ 0.75).',
    ],
  };
}
