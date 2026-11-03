import type { Payment, PlayerState, Profile, ProgramState, ScenarioAnswer, Session, SkillState, Subscription, TaskAnswer } from './types';

type ExportSource = {
  profile: Profile;
  skills: (SkillState & { profileId: string })[];
  sessions: Session[];
  programStates: ProgramState[];
  playerStates: PlayerState[];
  subs: Subscription[];
  payments: Payment[];
};
const strings = (values: unknown): string[] => Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
const progress = (values: Record<string, number> | undefined): Record<string, number> => Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => key.length <= 80 && typeof value === 'number' && Number.isFinite(value)));
const task = ({ taskId, skill, level, correct, ms, assisted }: TaskAnswer) => ({ taskId, skill, level, correct, ms, assisted });
const scenario = (s?: ScenarioAnswer) => s ? { scenarioId: s.scenarioId, competency: s.competency, choice: s.choice, quality: s.quality } : undefined;

/** Explicit fields only. New server-side fields must not silently enter exports. */
export function makeProfileExport(source: ExportSource, exportedAt = new Date().toISOString()) {
  const p = source.profile; const id = p.id;
  return {
    formatVersion: 1,
    exportedAt,
    profile: { id: p.id, parentId: p.parentId, name: p.name, age: p.age, band: p.band, timeZone: p.timeZone, createdAt: p.createdAt },
    skills: source.skills.filter(s => s.profileId === id).map(({ profileId, skill, level, ability, streak, played, updatedAt }) => ({ profileId, skill, level, ability, streak, played, updatedAt })),
    sessions: source.sessions.filter(s => s.profileId === id).map(s => ({
      id: s.id, profileId: s.profileId, startedAt: s.startedAt, finishedAt: s.finishedAt, seconds: s.seconds,
      tasks: (s.tasks ?? []).map(task), scenario: scenario(s.scenario), plan: strings(s.plan),
      storySelection: s.storySelection ? { cardId: s.storySelection.cardId } : undefined,
      supportPracticeCompleted: s.supportPracticeCompleted === true ? true : undefined,
      inProgress: s.runtime ? { step: s.runtime.index, tasks: (s.runtime.taskAnswers ?? []).map(task), scenario: scenario(s.runtime.scenarioAnswer), supportPracticeCompleted: s.runtime.supportPracticeCompleted === true ? true : undefined } : undefined,
    })),
    program: source.programStates.filter(s => s.profileId === id).map(({ profileId, completedDays, lastDayIndex, startedAt }) => ({ profileId, completedDays, lastDayIndex, startedAt })),
    player: source.playerStates.filter(s => s.profileId === id).map(s => ({
      profileId: s.profileId, xp: s.xp, coins: s.coins, stars: s.stars, streak: s.streak, bestStreak: s.bestStreak,
      lastActiveDay: s.lastActiveDay, badges: strings(s.badges), inventory: strings(s.inventory),
      equipped: s.equipped && { head: s.equipped.head, body: s.equipped.body, pet: s.equipped.pet, room: s.equipped.room },
      missions: s.missions && { day: s.missions.day, ids: strings(s.missions.ids), progress: progress(s.missions.progress), claimed: strings(s.missions.claimed) },
      family: s.family && { version: s.family.version, completed: s.family.completed, current: s.family.current && { id: s.family.current.id, ideaId: s.family.current.ideaId, catalogVersion: s.family.current.catalogVersion, status: s.family.current.status } },
      stats: s.stats && { days: s.stats.days, tasks: s.stats.tasks, correctTasks: s.stats.correctTasks, scenarios: s.stats.scenarios, goodScenarios: s.stats.goodScenarios, bestCombo: s.stats.bestCombo, perfectDays: s.stats.perfectDays, minutes: s.stats.minutes },
      startedAt: s.startedAt,
    })),
    subscription: source.subs.filter(s => s.profileId === id).map(({ profileId, plan, status, startedAt, until }) => ({ profileId, plan, status, startedAt, until })),
    payments: source.payments.filter(p => p.profileId === id).map(({ plan, amount, currency, days, status, createdAt, appliedAt }) => ({ plan, amount, currency, days, status, createdAt, appliedAt })),
  };
}
