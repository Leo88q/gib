import { randomUUID } from 'node:crypto';
import { taskFeedback } from './task-feedback';
import { accuracyDelta, unassistedAccuracy } from './report-math';
import { checkTaskAnswer, type AnswerPayload } from './check-answer';
export type { AnswerPayload } from './check-answer';
import { store } from '../store';
import { TASK_BY_ID, taskForSkill, type TaskInstance } from '../content/cognitive';
import { SCENARIO_BY_ID as BASE_SCENARIOS, COMPETENCY_LABELS } from '../content/softskills';
import { SCENARIO_BY_ID as PROGRAM_SCENARIOS, TOTAL_DAYS, programDay } from '../content/program';
import type { Scenario } from '../content/softskills';
import { hasSupportPractice, makeSupportPractice } from '../content/support-practice';
import { STORYLETS_BY_ID } from '../content/storylets';
import { selectStoryCards, DAY_STORY_CARDS, type StoryChoice } from '../day/story-deck';
import { nextDayStage } from '../day/day-machine';
import { eventJournal, dedupeKeyFor, type EventJournal } from '../events/journal';
import { dueReviewTopics, reviewStatesFromSessions, reviewDayKeyFor, type ReviewTopic } from '../review/topics';
import { applyReview } from '../review/intervals';
import { nextJourneyStage } from '../day/journey-machine';
import { weekOneInk } from './week-one-ink-catalog';
import { remainingInk } from './remaining-ink-catalog';
import { readInkScene, validateInkVariant } from './ink-snapshot';
import { readDeepInk, validateDeepInkVariant } from './deep-ink';
import { deepInkFor } from './deep-ink-catalog';
import { lazyDeepInk } from './deep-ink-lazy';
import { questForScenario, questForTask } from '../content/narrative';
import { levelOf } from '../gamification';
import { profileZone, calendarDay, weekStartDay, shiftDay, dayStart } from '../calendar';

/** Все сценарии: базовые (12) + программные (60). */
export const ALL_SCENARIOS: Record<string, Scenario> = {
  ...BASE_SCENARIOS,
  ...PROGRAM_SCENARIOS,
  ...STORYLETS_BY_ID,
};
import { advance, bandOf, initialSkill, pickSkills, SKILL_LABELS, SKILL_ORDER } from './adaptive';
import {
  claimMission,
  completeDay,
  earnScenario,
  earnSupportPractice,
  earnTask,
  ensureMissions,
  missionViews,
  refreshMissions,
  syncBadges,
} from './rewards';
import type {
  AgeBand,
  CompetencyId,
  PlayerState,
  Profile,
  Session,
  SkillId,
  SkillState,
  WeeklyReport,
} from '../types';

export type PlanItem =
  | { type: 'task'; taskId: string; skill: SkillId; boss?: boolean; practiceScenarioId?: string }
  | { type: 'scenario'; scenarioId: string };

export type RuntimeItem =
  | { type: 'task'; instance: TaskInstance; boss?: boolean }
  | { type: 'scenario'; scenarioId: string; order: number[]; content?: Scenario };

export type Runtime = {
  sessionId: string;
  profileId: string;
  plan: PlanItem[];
  items: RuntimeItem[];
  index: number;
  taskAnswers: { taskId: string; skill: SkillId; level: number; correct: boolean; ms: number; assisted?: boolean }[];
  scenarioAnswer?: {
    scenarioId: string;
    competency: CompetencyId;
    choice: number;
    /** Accepted on legacy sessions only. */
    quality?: 'good' | 'partial' | 'bad';
  };
  /** Индекс дня программы (0..59) */
  dayIndex: number;
  /** Это «новый» день программы (иначе — повтор) */
  advanceProgram: boolean;
  startedAt: number;
  stepStartedAt: number;
  /** Reopening a task makes its timing/comparison unsuitable for adaptation. */
  practiceSteps?: number[];
  /** Offer is fixed once and never re-drawn during resume. */
  storyOffer?: StoryChoice[];
  /** Internal content snapshots, never returned with the offer. */
  storyVersions?: Record<string, Scenario>;
  supportVersions?: Record<string, TaskInstance>;
  supportPracticeCompleted?: boolean;
  /** Отдельный заход-повторение темы: один сценарий, без прогресса программы. */
  review?: { topicId: string };
  /** Versioned XState story/practice segment; absent on earlier sessions. */
  storyFlow?: { version: 1; stage: 'choose_story' | 'story' | 'practice' | 'reflection' } | { version: 2; stage: 'choose_story' | 'story' | 'practice' | 'activities' };
  /* --- игровые счётчики текущего захода --- */
  combo: number;
  comboBest: number;
  correctStreak: number;
  xpEarned: number;
  coinsEarned: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
  goodChoice: boolean;
  isBossDay: boolean;
};


export type SessionStore = Pick<typeof store, 'transaction' | 'skills' | 'addSkill' | 'updateSkill' | 'programState' | 'setProgramState' | 'playerState' | 'setPlayerState' | 'sessions' | 'addSession' | 'getSession' | 'updateSession' | 'profile'> & {
  /** Журнал технических событий. Необязателен: старые вызовы и тесты работают без него. */
  journal?: EventJournal;
  /** Владелец профиля для изоляции журнала; по умолчанию — владелец из хранилища. */
  ownerId?: string;
};

/**
 * Записывает событие в журнал той же операции. Сбой журнала не должен
 * ломать игру ребёнка: журнал вторичен по отношению к прогрессу.
 */
function recordEvent(context: SessionStore, profileId: string, sessionId: string, step: number, kind: string, event: Parameters<EventJournal['append']>[3]) {
  const journal = context.journal ?? eventJournal;
  const owner = context.ownerId ?? context.profile(profileId)?.parentId ?? 'owner';
  try { journal.append(owner, profileId, dedupeKeyFor(sessionId, step, kind), event); } catch { /* журнал необязателен */ }
}

export function ensureSkills(profile: Profile, context: SessionStore = store): (SkillState & { profileId: string })[] {
  const existing = context.skills(profile.id);
  if (existing.length === 0) {
    for (const skill of SKILL_ORDER) {
      context.addSkill({ ...initialSkill(skill, profile.band), profileId: profile.id });
    }
  }
  return context.skills(profile.id);
}

/**
 * План дня берётся из программы: неделя задаёт тему, день — конкретный
 * сценарий и тройку когнитивных навыков. Сложность внутри заданий
 * остаётся адаптивной (по уровню ребёнка).
 *
 * Пятый день недели — «испытание»: к нему добавляется быстрая финальная
 * задача-босс с отдельным оформлением и бонусом.
 */
export function programPosition(profileId: string) {
  const state = store.programState(profileId);
  const dayIndex = Math.min(state.completedDays, TOTAL_DAYS - 1);
  const { week, day } = programDay(dayIndex);
  return { state, dayIndex, week, day, finished: state.completedDays >= TOTAL_DAYS };
}

export function buildPlan(profile: Profile, repeat = false, context: SessionStore = store): PlanItem[] {
  ensureSkills(profile, context);
  const state = context.programState(profile.id);
  let dayIndex = state.completedDays;
  if (repeat) dayIndex = state.lastDayIndex;
  dayIndex = Math.max(0, Math.min(dayIndex, TOTAL_DAYS - 1));

  const { day } = programDay(dayIndex);
  const tasks = day.skills.map((skill) => ({
    type: 'task' as const,
    taskId: taskForSkill(skill, dayIndex).id,
    skill,
  }));
  // Ритм: два задания — сценарий — третье задание
  const plan: PlanItem[] = [tasks[0], tasks[1], { type: 'scenario', scenarioId: day.scenarioId }, tasks[2]];

  if (day.day === 5) {
    // испытание дня: ещё одна быстрая задача по фокусу недели
    const bossSkill = day.focus;
    plan.push({
      type: 'task',
      taskId: taskForSkill(bossSkill, dayIndex + 1).id,
      skill: bossSkill,
      boss: true,
    });
  }
  return plan;
}

/** New session snapshots contain text and choices, but no legacy judgment labels. */
function snapshotStory(sc: Scenario, inkBand?: AgeBand, deep = false): Scenario {
  const copy = structuredClone(sc);
  for (const variant of Object.values(copy.variants)) for (const option of variant.options) delete option.quality;
  if (inkBand) { const json=weekOneInk(copy.id,inkBand) ?? remainingInk(copy.id,inkBand); if(json) { copy.variants[inkBand].ink={version:1,json}; if(!validateInkVariant(copy.variants[inkBand])) throw Error('ink_catalog_mismatch'); } }
  if (deep && inkBand) {
    // Готовое дерево (первые дни) имеет приоритет; остальные истории получают
    // второй шаг из тех же текстов через ленивую сборку. Снимок сессии всё равно
    // хранит готовое дерево, поэтому старые сессии не зависят от каталога.
    const json = deepInkFor(copy.id, inkBand) ?? lazyDeepInk(copy, inkBand) ?? undefined;
    if (json) { copy.variants[inkBand].deepInk = { version: 1, json }; if (!validateDeepInkVariant(copy.variants[inkBand])) throw Error('deep_ink_catalog_mismatch'); }
  }
  return copy;
}

function buildItem(profile: Profile, item: PlanItem, context: SessionStore, frozenStory?: Scenario): RuntimeItem {
  if (item.type === 'scenario') {
    const sc = frozenStory ? structuredClone(frozenStory) : snapshotStory(ALL_SCENARIOS[item.scenarioId]);
    const count = sc.variants[profile.band].options.length;
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { type: 'scenario', scenarioId: item.scenarioId, order, content: sc };
  }
  if (item.taskId === 'support-practice') return { type: 'task', instance: makeSupportPractice(profile.band, item.practiceScenarioId ?? 'w1d1') };
  const state = context.skills(profile.id).find((s) => s.skill === item.skill);
  const def = TASK_BY_ID[item.taskId];
  const level = state?.level ?? 1;
  return { type: 'task', instance: def.make(level, profile.band), boss: item.boss };
}

/** Убираем серверный ключ ответа перед отправкой клиенту. */
export function publicItem(item: RuntimeItem, band: AgeBand) {
  if (item.type === 'task') {
    const { answer, options, ...rest } = item.instance;
    void answer;
    // флаг `correct` клиенту не отдаём — иначе ответ можно прочитать из payload
    const safeOptions = options?.map((o) => ({ id: o.id, label: o.label, color: o.color }));
    return {
      type: 'task' as const,
      boss: Boolean(item.boss),
      quest: questForTask(item.instance.taskId, item.instance.title),
      instance: { ...rest, options: safeOptions, grid: rest.grid?.map(({ color }) => ({ color })) },
    };
  }
  const sc = item.content ?? ALL_SCENARIOS[item.scenarioId];
  const variant = sc.variants[band];
  const ink = variant.ink ? readInkScene(variant.ink) : null;
  return {
    type: 'scenario' as const,
    scenarioId: sc.id,
    competency: sc.competency,
    skillLabel: sc.skillLabel,
    quest: questForScenario(sc.competency),
    variant: {
      title: variant.title,
      text: ink?.text ?? variant.text,
      options: item.order.map((i) => ({ text: ink ? ink.choices[i] : variant.options[i].text })),
      ...(variant.deepInk ? { followUps: item.order.map(i => readDeepInk(variant.deepInk!, [i])) } : {}),
    },
  };
}

/**
 * Отдельный заход-повторение: одна история, которую ребёнок уже проходил.
 *
 * Решения, зафиксированные здесь:
 * - повтор — своя сессия с одним этапом, он не встраивается в план дня и не
 *   меняет прогресс программы (`advanceProgram: false`);
 * - награда обычная, как за историю: отдельного «бонуса за повтор» нет, чтобы
 *   не подталкивать к зубрёжке; уйти можно в любой момент;
 * - при завершении тема получает новый срок.
 */
function startReviewSession(
  profile: Profile,
  topic: ReviewTopic,
  reviewStates: ReturnType<typeof reviewStatesFromSessions>,
  context: SessionStore,
): { sessionId: string; item: unknown; steps: number; step: number; resumed: boolean; combo: number; review: { topicId: string; title: string } } | null {
  const scenario = ALL_SCENARIOS[topic.scenarioId];
  if (!scenario) return null;
  const item: PlanItem = { type: 'scenario', scenarioId: topic.scenarioId };
  const built = buildItem(profile, item, context, snapshotStory(scenario, profile.band, false));
  const id = 's_' + randomUUID();
  const rt: Runtime = {
    sessionId: id, profileId: profile.id, plan: [item], items: [built], index: 0, taskAnswers: [],
    dayIndex: context.programState(profile.id).lastDayIndex, advanceProgram: false,
    startedAt: Date.now(), stepStartedAt: Date.now(), combo: 0, comboBest: 0, correctStreak: 0,
    xpEarned: 0, coinsEarned: 0, newBadges: [], levelUp: null, goodChoice: false, isBossDay: false,
    review: { topicId: topic.topicId },
  };
  context.addSession({ id, profileId: profile.id, startedAt: rt.startedAt, seconds: 0, tasks: [], plan: [`scenario:${topic.scenarioId}`], runtime: rt });
  context.setProgramState({ ...context.programState(profile.id), reviewStates, reviewDay: reviewDayKeyFor(profile) });
  recordEvent(context, profile.id, id, 0, 'start', { v: 1, type: 'session_started', dayIndex: rt.dayIndex, repeat: true, journey: false });
  return { sessionId: id, item: publicItem(built, profile.band), steps: 1, step: 0, resumed: false, combo: 0, review: { topicId: topic.topicId, title: topic.title } };
}

/** Завершает повтор: срок сдвигается вперёд. Отказ ничего не отнимает — тема просто закрывается. */
function finishReview(context: SessionStore, profileId: string, topicId: string, outcome: 'reviewed' | 'refused') {
  const state = context.programState(profileId);
  const states = state.reviewStates ?? [];
  const found = states.find(s => s.topicId === topicId);
  if (!found) return;
  const next = applyReview(found, outcome, Date.now());
  if (!next.ok) return;
  context.setProgramState({ ...state, reviewStates: states.map(s => s.topicId === topicId ? next.state : s) });
}

export function startSession(
  profile: Profile,
  repeat = false,
  context: SessionStore = store,
  options: { storyChoice?: boolean; journey?: boolean; review?: boolean; reviewTopicId?: string } = {}
): { sessionId: string; item: unknown; steps: number; step: number; resumed: boolean; combo: number; storyOffer?: StoryChoice[]; storySelected?: string | null; autoClaimed?: { count: number; xp: number; coins: number }; review?: { topicId: string; title: string } } {
  return context.transaction(() => {
  /* --- повторение темы: необязательный отдельный заход, не блокирует новый день --- */
  const stateNow = context.programState(profile.id);
  const reviewStates = reviewStatesFromSessions(context.sessions(profile.id), profile.band, Date.now(), stateNow.reviewStates ?? []);
  if (!repeat && options.review === true && stateNow.reviewOff !== true && stateNow.reviewDay !== reviewDayKeyFor(profile)) {
    // Если тем несколько, ребёнок может выбрать любую из подходящих по сроку.
    // Выбор — предпочтение, а не оценка: все варианты одинаково «созрели».
    const candidates = dueReviewTopics(reviewStates, profile.band, Date.now(), 5);
    const picked = options.reviewTopicId ? candidates.find(t => t.topicId === options.reviewTopicId) : undefined;
    const due = picked ?? candidates[0];
    if (due) {
      const started = startReviewSession(profile, due, reviewStates, context);
      if (started) return started;
    }
  }

  const active = [...context.sessions(profile.id)].reverse().find(s => !s.finishedAt && s.runtime && s.runtime.index < s.runtime.items.length);
  if (active?.runtime) {
    const rt = active.runtime;
    const current = rt.items[rt.index];
    if (current.type === 'task' && current.instance.kind !== 'social-practice' && (!rt.storyOffer || active.storySelection)) {
      rt.practiceSteps ??= [];
      if (!rt.practiceSteps.includes(rt.index)) rt.practiceSteps.push(rt.index);
      context.updateSession(active.id, { runtime: rt });
    }
    return { sessionId: active.id, item: publicItem(current, profile.band), steps: rt.items.length, step: rt.index, resumed: true, combo: rt.combo ?? 0, ...(rt.storyOffer ? { storyOffer: rt.storyOffer, storySelected: active.storySelection?.cardId ?? null } : {}) };
  }
  const state = context.programState(profile.id);
  const plan = buildPlan(profile, repeat, context);
  const dayIndex = repeat ? state.lastDayIndex : Math.min(state.completedDays, TOTAL_DAYS - 1);
  const id = 's_' + randomUUID();
  const offer = options.storyChoice ? selectStoryCards(dayIndex, profile.band, [], id, DAY_STORY_CARDS) : [];
  const scenarioIndex = plan.findIndex(item => item.type === 'scenario');
  const scenarioPlan = plan[scenarioIndex];
  if (options.storyChoice && scenarioPlan?.type === 'scenario' && hasSupportPractice(scenarioPlan.scenarioId)) {
    plan.splice(scenarioIndex + 1, 0, { type: 'task', taskId: 'support-practice', skill: 'inhibition', practiceScenarioId: scenarioPlan.scenarioId });
  }
  // Version 2 is opt-in. Existing active sessions are never reordered.
  const journey = options.journey === true && options.storyChoice === true && offer.length > 1 && plan.some(p => p.type === 'task' && p.taskId === 'support-practice');
  if (journey) {
    const story = plan.splice(plan.findIndex(p => p.type === 'scenario'), 1)[0];
    const practice = plan.splice(plan.findIndex(p => p.type === 'task' && p.taskId === 'support-practice'), 1)[0];
    plan.unshift(story, practice);
  }
  const items = plan.map((p) => buildItem(profile, p, context));
  const player = context.playerState(profile.id);
  const autoClaimed = ensureMissions(player, dayIndex);
  context.setPlayerState(player);

  const rt: Runtime = {
    sessionId: id,
    profileId: profile.id,
    ...(options.storyChoice && plan.some(p => p.type === 'task' && p.taskId === 'support-practice') ? { storyFlow: journey ? { version: 2 as const, stage: 'choose_story' as const } : { version: 1 as const, stage: offer.length > 1 ? 'choose_story' as const : 'story' as const } } : {}),
    ...(offer.length > 1 ? { storyOffer: offer, storyVersions: Object.fromEntries(offer.map(card => [card.id, snapshotStory(ALL_SCENARIOS[card.scenarioId], profile.band, journey)])), supportVersions: Object.fromEntries(offer.map(card => [card.id, makeSupportPractice(profile.band, card.scenarioId)])) } : {}),
    plan,
    items,
    index: 0,
    taskAnswers: [],
    dayIndex,
    advanceProgram: !repeat && dayIndex === state.completedDays,
    startedAt: Date.now(),
    stepStartedAt: Date.now(),
    combo: 0,
    comboBest: 0,
    correctStreak: 0,
    xpEarned: 0,
    coinsEarned: 0,
    newBadges: [],
    levelUp: null,
    goodChoice: false,
    isBossDay: plan.some((p) => p.type === 'task' && p.boss),
  };

  const durable: Session = {
    id,
    profileId: profile.id,
    startedAt: rt.startedAt,
    seconds: 0,
    tasks: [],
    plan: plan.map((p) => (p.type === 'task' ? p.taskId : `scenario:${p.scenarioId}`)),
    runtime: rt,
  };
  context.addSession(durable);
  recordEvent(context, profile.id, id, 0, 'start', { v: 1, type: 'session_started', dayIndex, repeat, journey: Boolean(rt.storyFlow?.version === 2) });

  return { sessionId: id, item: publicItem(items[0], profile.band), steps: items.length, step: 0, resumed: false, combo: 0, autoClaimed, ...(rt.storyOffer ? { storyOffer: rt.storyOffer, storySelected: null } : {}) };
  });
}

/** Select once under the same transaction as the session; receipt survives completion. */
export function selectSessionStory(sessionId: string, cardId: string, context: SessionStore = store): { ok: true; cardId: string } | { error: 'session_not_found' | 'story_conflict' | 'invalid_story' } {
  return context.transaction(() => {
    const session = context.getSession(sessionId);
    if (!session) return { error: 'session_not_found' };
    if (session.storySelection) return session.storySelection.cardId === cardId ? { ok: true, cardId } : { error: 'story_conflict' };
    const rt = session.runtime;
    if (!rt?.storyOffer || rt.index !== 0) return { error: 'invalid_story' };
    const card = rt.storyOffer.find(c => c.id === cardId);
    const profile = context.profile(session.profileId);
    const index = rt.plan.findIndex(item => item.type === 'scenario');
    if (!card || !profile || index < 0 || !Object.hasOwn(ALL_SCENARIOS, card.scenarioId)) return { error: 'invalid_story' };
    if (rt.storyFlow) {
      const stage = rt.storyFlow.version === 2 ? nextJourneyStage(rt.storyFlow.stage, { type: 'story_selected' }) : nextDayStage(rt.storyFlow.stage, { type: 'story_selected', cardId });
      if (stage !== 'story') return { error: 'story_conflict' };
      rt.storyFlow = rt.storyFlow.version === 2 ? { version: 2, stage } : { version: 1, stage };
    }
    const planItem: PlanItem = { type: 'scenario', scenarioId: card.scenarioId };
    rt.plan[index] = planItem;
    rt.items[index] = buildItem(profile, planItem, context, rt.storyVersions?.[cardId]);
    const practiceIndex = rt.plan.findIndex(p => p.type === 'task' && p.taskId === 'support-practice');
    if (practiceIndex >= 0) {
      const practice = rt.plan[practiceIndex];
      if (practice.type === 'task') practice.practiceScenarioId = card.scenarioId;
      rt.items[practiceIndex] = { type: 'task', instance: structuredClone(rt.supportVersions?.[cardId] ?? makeSupportPractice(profile.band, card.scenarioId)) };
    }
    delete rt.storyVersions; delete rt.supportVersions;
    const plan = session.plan.slice(); plan[index] = `scenario:${card.scenarioId}`;
    context.updateSession(sessionId, { runtime: rt, plan, storySelection: { cardId } });
    recordEvent(context, session.profileId, sessionId, 0, 'story', { v: 1, type: 'story_selected', cardId, offerSize: rt.storyOffer?.length ?? 1 });
    return { ok: true, cardId };
  });
}

export type RewardInfo = {
  xp: number;
  coins: number;
  combo: number;
  comboBest: number;
  totalXp: number;
  totalCoins: number;
  stars?: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
  missions: ReturnType<typeof missionViews>;
};

function validAnswer(item: RuntimeItem, payload: AnswerPayload, band: AgeBand): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (payload.assisted !== undefined && typeof payload.assisted !== 'boolean') return false;
  if (payload.skip === true) return item.type === 'task' && item.instance.kind === 'social-practice' && Object.keys(payload).length === 1;
  if (item.type === 'scenario') {
    if (!Number.isInteger(payload.index) || payload.index! < 0 || payload.index! >= item.order.length) return false;
    if (payload.cells === undefined) return true; // Older clients may still submit one choice.
    const deep = item.content?.variants[band].deepInk;
    if (!deep || !Array.isArray(payload.cells) || payload.cells.length !== 1 || !Number.isInteger(payload.cells[0])) return false;
    const choices = readDeepInk(deep, [item.order[payload.index!]]).choices;
    return payload.cells[0] >= 0 && payload.cells[0] < choices.length;
  }
  const task = item.instance;
  const array = (value: unknown, limit: number) => Array.isArray(value) && value.length <= limit && value.every(v => Number.isInteger(v) && v >= 0 && v < limit) && new Set(value).size === value.length;
  if (task.kind === 'social-practice') return Object.keys(payload).every(k => k === 'cells') && Array.isArray(payload.cells) && Array.isArray(task.rounds) && payload.cells.length === task.rounds.length && payload.cells.every((v, i) => Number.isInteger(v) && v >= 0 && v < task.rounds![i].options.length);
  if (task.kind === 'choice') return Number.isInteger(payload.index) && payload.index! >= 0 && payload.index! < (task.options?.length ?? 0);
  if (task.kind === 'cards') return Number.isInteger(payload.index) && payload.index! >= 0 && payload.index! < (task.cards?.length ?? 0);
  if (task.kind === 'memory' || task.kind === 'symbol-memory') return array(payload.cells, (task.rows ?? 3) * (task.cols ?? 3));
  if (task.kind === 'switch-rounds') return Array.isArray(payload.cells) && payload.cells.length === task.rules?.length && payload.cells.every(v => Number.isInteger(v) && v >= 0 && v < (task.cards?.length ?? 0));
  if (task.kind === 'order') return array(payload.cells, task.steps?.length ?? 0) && payload.cells!.length === task.steps?.length;
  if (task.kind === 'finddiff') return array(payload.cells, task.cards?.length ?? 0);
  if (task.kind === 'gonogo') return array(payload.targets, task.grid?.length ?? 0);
  return task.kind === 'digits' && typeof payload.digits === 'string' && /^\d{1,6}$/.test(payload.digits);
}

export type AnswerSuccess = {
      correct: boolean;
      evaluation?: 'not_scored';
      feedback: string;
      goodNote?: string;
      next: unknown | null;
      done: boolean;
      reward: RewardInfo;
      summary?: {
        tasks: number;
        correct: number;
        stars: number;
        comboBest: number;
      };
    };

export function answerStep(
  sessionId: string,
  payload: AnswerPayload,
  ms: number,
  expectedStep: number,
  context: SessionStore = store
): { error: string } | AnswerSuccess {
  return context.transaction(() => {
  const saved = context.getSession(sessionId);
  if (saved?.runtime?.storyOffer && !saved.storySelection) return { error: 'story_selection_required' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload.assisted !== undefined && typeof payload.assisted !== 'boolean')) return { error: 'invalid_answer' };
  if ('skip' in payload && (payload.skip !== true || Object.keys(payload).length !== 1)) return { error: 'invalid_answer' };
  const parts: unknown[] = [payload?.index ?? null, payload?.cells ?? null, payload?.digits ?? null, payload?.targets ?? null];
  if (payload.skip === true) parts.push('skip');
  // Preserve fingerprints of existing unassisted receipts.
  if (payload?.assisted === true) parts.push(true);
  const fingerprint = JSON.stringify(parts);
  if (saved?.lastReceipt?.step === expectedStep) {
    return saved.lastReceipt.fingerprint === fingerprint ? saved.lastReceipt.result : { error: 'step_conflict' };
  }
  const rt = saved?.runtime;
  if (!rt || saved?.finishedAt) return { error: 'session_not_found' };
  if (rt.index !== expectedStep) return { error: 'step_conflict' };
  const item = rt.items[rt.index];
  const profile = context.profile(rt.profileId);
  if (!profile) return { error: 'profile_not_found' };
  // «Отказаться от выбора» можно и в повторе: это законный ответ без варианта.
  const refusal = rt.review !== undefined && item.type === 'scenario' && payload.index === undefined && payload.cells === undefined && payload.digits === undefined && payload.targets === undefined && payload.skip === undefined;
  if (!item || (!refusal && !validAnswer(item, payload, bandOf(profile.age)))) return { error: 'invalid_answer' };
  ms = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 600_000)) : 0;
  // Only actual story/practice events are tracked. Check-in, pause and reflection
  // remain local and no use or choice is inferred from opening the mission.
  if (rt.storyFlow && (item.type === 'scenario' || (item.type === 'task' && item.instance.kind === 'social-practice'))) {
    const event = item.type === 'scenario' ? { type: 'story_done' as const } : { type: payload.skip ? 'practice_skipped' as const : 'practice_done' as const };
    if (rt.storyFlow.version === 2) {
      const stage = nextJourneyStage(rt.storyFlow.stage, event);
      if (stage !== (item.type === 'scenario' ? 'practice' : 'activities')) return { error: 'story_flow_conflict' };
      rt.storyFlow = { version: 2, stage };
    } else {
      const stage = nextDayStage(rt.storyFlow.stage, event);
      if (stage !== (item.type === 'scenario' ? 'practice' : 'reflection')) return { error: 'story_flow_conflict' };
      rt.storyFlow = { version: 1, stage };
    }
  }
  if (rt.storyFlow?.version === 2 && item.type === 'task' && item.instance.kind !== 'social-practice' && rt.storyFlow.stage !== 'activities') return { error: 'story_flow_conflict' };
  if (rt.storyFlow?.version === 2 && rt.index === rt.items.length - 1 && nextJourneyStage(rt.storyFlow.stage, { type: 'activities_done' }) !== 'reflection') return { error: 'story_flow_conflict' };
  const player = context.playerState(rt.profileId);

  let correct = false;
  let feedback = '';
  let goodNote: string | undefined;

  if (item.type === 'task' && item.instance.kind === 'social-practice') {
    feedback = payload.skip ? 'Хорошо, пропустим. Продолжим в удобном темпе.' : 'Ты собрал идеи для истории. Можно выбирать по-разному.';
    if (!payload.skip) rt.supportPracticeCompleted = true;
    const earned = earnSupportPractice(player);
    rt.xpEarned += earned.xp; rt.coinsEarned += earned.coins;
    if (earned.levelUp) rt.levelUp = earned.levelUp;
    recordEvent(context, rt.profileId, sessionId, rt.index, 'answer', { v: 1, type: 'practice_answered', skipped: payload.skip === true });
  } else if (item.type === 'task') {
    correct = checkTaskAnswer(item.instance, payload);
    const assisted = payload.assisted === true || Boolean(rt.practiceSteps?.includes(rt.index));
    feedback = taskFeedback(item.instance, correct, assisted);
    const state = context.skills(rt.profileId).find((s) => s.skill === item.instance.skill);
    if (state) {
      const def = TASK_BY_ID[item.instance.taskId];
      const nextState = assisted ? null : advance(state, correct, ms, def.targetMs, profile.band);
      if (nextState) context.updateSkill(rt.profileId, item.instance.skill, {
        level: nextState.level,
        ability: nextState.ability,
        streak: nextState.streak,
        played: state.played + 1,
        updatedAt: Date.now(),
      });
      rt.taskAnswers.push({
        taskId: item.instance.taskId,
        skill: item.instance.skill,
        level: state.level,
        correct,
        ms,
        ...(assisted ? { assisted: true } : {}),
      });
    }

    // игровые счётчики
    if (correct) {
      rt.combo += 1;
      rt.correctStreak += 1;
      rt.comboBest = Math.max(rt.comboBest, rt.combo);
    } else {
      rt.combo = 0;
      rt.correctStreak = 0;
    }
    player.stats.bestCombo = Math.max(player.stats.bestCombo, rt.comboBest);
    const earned = earnTask(player, correct, rt.combo);
    rt.xpEarned += earned.xp;
    rt.coinsEarned += earned.coins;
    if (earned.levelUp) rt.levelUp = earned.levelUp;
    recordEvent(context, rt.profileId, sessionId, rt.index, 'answer', { v: 1, type: 'task_answered', taskKind: String(item.instance.kind), taskSkill: item.instance.skill, correct, assisted: payload.assisted === true || Boolean(rt.practiceSteps?.includes(rt.index)), ms });
    refreshMissions(player, {
      dayIndex: rt.dayIndex,
      tasksDone: rt.taskAnswers.length,
      comboBest: rt.comboBest,
      correctStreak: rt.correctStreak,
      goodChoice: rt.goodChoice,
      perfectDay: false,
      bossPassed: false,
      stars: 0,
    });
  } else {
    const sc = item.content ?? ALL_SCENARIOS[item.scenarioId];
    const variant = sc.variants[bandOf(profile.age)];
    // Отказ от выбора (только в повторе): без варианта, без оценки и без награды.
    const declined = payload.index === undefined && payload.cells === undefined;
    const originalIndex = declined ? -1 : (item.order[payload.index ?? -1] ?? -1);
    const chosen = declined ? undefined : variant.options[originalIndex];
    // A story choice is not a test of the child's character.
    correct = false;
    feedback = declined
      ? 'Хорошо. Историю можно оставить и вернуться к ней позже.'
      : variant.deepInk && payload.cells ? readDeepInk(variant.deepInk, [originalIndex, payload.cells[0]]).text : variant.ink ? readInkScene(variant.ink, originalIndex).text : chosen?.note ?? '';
    goodNote = undefined;
    rt.scenarioAnswer = {
      scenarioId: sc.id,
      competency: sc.competency as CompetencyId,
      choice: payload.index ?? -1,
    };
    // The mission tracks participation; story choices do not change task combo.
    rt.goodChoice = true;
    recordEvent(context, rt.profileId, sessionId, rt.index, 'answer', { v: 1, type: 'story_answered', choiceIndex: Math.max(0, rt.scenarioAnswer.choice), itemCount: rt.items.length });
    const earned = declined ? { xp: 0, coins: 0, levelUp: null as null } : earnScenario(player);
    rt.xpEarned += earned.xp;
    rt.coinsEarned += earned.coins;
    if (earned.levelUp) rt.levelUp = earned.levelUp;
    refreshMissions(player, {
      dayIndex: rt.dayIndex,
      tasksDone: rt.taskAnswers.length,
      comboBest: rt.comboBest,
      correctStreak: rt.correctStreak,
      goodChoice: rt.goodChoice,
      perfectDay: false,
      bossPassed: false,
      stars: 0,
    });
  }

  rt.index += 1;
  rt.stepStartedAt = Date.now();

  if (rt.index >= rt.items.length) {
    const seconds = Math.round((Date.now() - rt.startedAt) / 1000);
    const durable = context.getSession(sessionId);
    if (durable) {
      context.updateSession(sessionId, {
        finishedAt: Date.now(),
        seconds,
        tasks: rt.taskAnswers,
        scenario: rt.scenarioAnswer,
        ...(rt.supportPracticeCompleted ? { supportPracticeCompleted: true } : {}),
      });
    }
    // Расписание повторения обновляется в момент завершения: тема только что пройдена.
    const stateAfter = context.programState(rt.profileId);
    const scheduled = reviewStatesFromSessions(context.sessions(rt.profileId), profile.band, Date.now(), stateAfter.reviewStates ?? []);
    const advance = rt.advanceProgram && stateAfter.completedDays === rt.dayIndex;
    context.setProgramState({
      ...stateAfter,
      ...(advance ? { completedDays: Math.min(stateAfter.completedDays + 1, TOTAL_DAYS), lastDayIndex: rt.dayIndex } : {}),
      reviewStates: scheduled,
    });
    const weekDone = Math.floor(context.programState(rt.profileId).completedDays / 5);
    /*
     * Повтор — не день программы: он не даёт «награду за день», не двигает
     * статистику дней и не меняет звёзды. Остаётся только то, что ребёнок
     * реально сделал (награда за историю начислена выше и уже в rt.xpEarned).
     */
    const done = rt.review
      ? { stars: 0, xp: 0, coins: 0, newBadges: [] as string[], levelUp: null }
      : completeDay(player, {
      tasks: rt.taskAnswers.length,
      correct: rt.taskAnswers.filter((t) => t.correct).length,
      scenarioCompleted: Boolean(rt.scenarioAnswer),
      seconds,
      isBoss: rt.isBossDay,
      dayIndex: rt.dayIndex,
      weekDone,
      comboBest: rt.comboBest,
      correctStreak: rt.correctStreak,
      timeZone: profileZone(profile.timeZone),
    }, context);
    const badges = syncBadges(player, weekDone, context);
    context.setPlayerState(player);
    const result: AnswerSuccess = {
      ...((item.type === 'scenario' || item.instance.kind === 'social-practice') ? { evaluation: 'not_scored' as const } : {}),
      correct,
      feedback,
      goodNote,
      next: null,
      done: true,
      reward: {
        xp: rt.xpEarned,
        coins: rt.coinsEarned,
        combo: rt.combo,
        comboBest: rt.comboBest,
        totalXp: player.xp,
        totalCoins: player.coins,
        stars: done.stars,
        newBadges: [...new Set([...rt.newBadges, ...badges])],
        levelUp: rt.levelUp,
        missions: missionViews(player),
      },
      summary: {
        tasks: rt.taskAnswers.length,
        correct: rt.taskAnswers.filter((t) => t.correct).length,
        stars: done.stars,
        comboBest: rt.comboBest,
      },
    };
    // Повтор: сдвигаем срок темы. Отказ от выбора не наказывает — тема просто закрывается.
    if (rt.review) finishReview(context, rt.profileId, rt.review.topicId, payload.index === undefined ? 'refused' : 'reviewed');
    context.updateSession(sessionId, { runtime: undefined, lastReceipt: { step: expectedStep, fingerprint, result } });
    recordEvent(context, rt.profileId, sessionId, expectedStep, 'complete', { v: 1, type: 'session_completed', steps: rt.taskAnswers.length, correct: rt.taskAnswers.filter(t => t.correct).length, stars: done.stars, seconds });
    return result;
  }

  context.setPlayerState(player);
  const result: AnswerSuccess = {
    ...((item.type === 'scenario' || item.instance.kind === 'social-practice') ? { evaluation: 'not_scored' as const } : {}),
    correct,
    feedback,
    goodNote,
    next: publicItem(rt.items[rt.index], profile.band),
    done: false,
    reward: {
      xp: rt.xpEarned,
      coins: rt.coinsEarned,
      combo: rt.combo,
      comboBest: rt.comboBest,
      totalXp: player.xp,
      totalCoins: player.coins,
      newBadges: rt.newBadges,
      levelUp: rt.levelUp,
      missions: missionViews(player),
    },
  };
  context.updateSession(sessionId, { runtime: rt, lastReceipt: { step: expectedStep, fingerprint, result } });
  return result;
  });
}

/* --------------------------- отчёт для родителя --------------------------- */

export function buildReport(profile: Profile): WeeklyReport {
  const now = Date.now();
  const zone = profileZone(profile.timeZone);
  const weekDay = weekStartDay(now, zone);
  const weekStart = dayStart(weekDay, zone);
  const prevDay = shiftDay(weekDay, -7);
  const sessions = store.sessions(profile.id).filter((s) => typeof s.finishedAt === 'number');
  const week = sessions.filter((s) => s.finishedAt! <= now && calendarDay(s.finishedAt!, zone) >= weekDay);
  const prev = sessions.filter((s) => { const day = calendarDay(s.finishedAt!, zone); return day >= prevDay && day < weekDay; });

  const totalSeconds = week.reduce((acc, s) => acc + (s.seconds || 0), 0);
  const minutes = week.length ? Math.max(1, Math.round(totalSeconds / 60)) : 0;
  const tasksDone = week.reduce((acc, s) => acc + s.tasks.length, 0);
  const assistedTasks = week.reduce((acc, s) => acc + s.tasks.filter(t => t.assisted).length, 0);
  const scenariosDone = week.filter((s) => s.scenario).length;

  const cur = unassistedAccuracy(week);
  const old = unassistedAccuracy(prev);

  const skills = SKILL_ORDER.map((skill) => {
    const c = cur[skill];
    const o = old[skill];
    const delta = accuracyDelta(c, o);
    const state = store.skills(profile.id).find((s) => s.skill === skill);
    return {
      skill,
      label: SKILL_LABELS[skill],
      delta,
      ability: state?.ability ?? 0,
    };
  });

  const weekScenarios = week.filter((s) => s.scenario).map((s) => s.scenario!);
  const notes = weekScenarios
    .map((s) => {
      const sc = ALL_SCENARIOS[s.scenarioId];
      return sc ? { scenarioId: sc.id, text: sc.report } : null;
    })
    .filter(Boolean) as { scenarioId: string; text: string }[];

  const lastScenario = weekScenarios.length
    ? ALL_SCENARIOS[weekScenarios[weekScenarios.length - 1].scenarioId]
    : null;

  const improved = [...skills].filter((s) => s.delta !== null && s.delta > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  const win = improved
    ? `«${improved.label}» — доля верных ответов выросла на ${improved.delta} п.п. по сравнению с прошлой неделей.`
    : week.length ? 'Ребёнок завершил занятия на этой неделе.' : 'Завершённых занятий на этой неделе пока нет.';

  const pos = programPosition(profile.id);
  const player = store.playerState(profile.id);
  const lvl = levelOf(player.xp);

  return {
    weekStart,
    minutes,
    sessions: week.length,
    tasksDone,
    assistedTasks,
    scenariosDone,
    supportPracticesDone: week.filter(s => s.supportPracticeCompleted).length,
    skills,
    win,
    growth: lastScenario?.growth ?? 'Пока недостаточно данных для вывода.',
    home: lastScenario?.home ?? 'Сыграйте вместе 10 минут в настольную игру.',
    question: lastScenario?.question ?? 'Что сегодня было хорошего?',
    scenarioNotes: notes,
    program: {
      week: pos.week.week,
      weekTitle: pos.week.title,
      day: pos.day.day,
      dayTheme: pos.day.theme,
      completedDays: pos.state.completedDays,
      totalDays: TOTAL_DAYS,
      finished: pos.finished,
    },
    player: {
      level: lvl.level,
      levelTitle: lvl.title,
      xp: player.xp,
      coins: player.coins,
      stars: player.stars,
      badges: player.badges.length,
      days: player.stats.days,
      perfectDays: player.stats.perfectDays,
    },
  };
}

export { COMPETENCY_LABELS, claimMission };
export type { PlayerState };
