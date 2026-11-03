export type AgeBand = '5-7' | '8-10' | '11-13';

export type SkillId =
  | 'attention'
  | 'working_memory'
  | 'flexibility'
  | 'inhibition'
  | 'planning'
  | 'logic';

export type CompetencyId =
  | 'self_awareness'
  | 'self_regulation'
  | 'empathy'
  | 'relationships'
  | 'decision_making'
  | 'creative_thinking'
  | 'growth_mindset';

export type PlanId = 'month' | 'year' | 'year_pro';

export type Profile = {
  id: string;
  parentId: string;
  name: string;
  age: number;
  band: AgeBand;
  timeZone?: string;
  createdAt: number;
};

export type SkillState = {
  skill: SkillId;
  level: number;
  ability: number; // 0..1 — оценка способности по навыку
  streak: number; // полоса верных (>0) или неверных (<0) подряд
  played: number;
  updatedAt: number;
};

export type TaskAnswer = {
  taskId: string;
  skill: SkillId;
  level: number;
  correct: boolean;
  ms: number;
  assisted?: boolean;
};

export type ScenarioAnswer = {
  scenarioId: string;
  competency: CompetencyId;
  choice: number;
  /** May occur only on legacy answers; never infer a child's qualities. */
  quality?: 'good' | 'partial' | 'bad';
};

export type Session = {
  id: string;
  profileId: string;
  startedAt: number;
  finishedAt?: number;
  seconds: number;
  tasks: TaskAnswer[];
  scenario?: ScenarioAnswer;
  plan: string[]; // taskIds + scenarioId
  runtime?: import('./engine/session').Runtime;
  /** Only the most recent response, for safe retries after a lost network response. */
  lastReceipt?: { step: number; fingerprint: string; result: import('./engine/session').AnswerSuccess };
  /** Persisted receipt for the optional story choice, including after completion. */
  storySelection?: { cardId: string };
  supportPracticeCompleted?: boolean;
};

export type Subscription = {
  profileId: string;
  plan: PlanId;
  status: 'active' | 'expired' | 'none';
  startedAt: number;
  until: number;
};

export type ProgramState = {
  profileId: string;
  /** Сколько дней программы пройдено (0..60) */
  completedDays: number;
  /** Какой день программы был последним (для повторения) */
  lastDayIndex: number;
  startedAt: number;
  /**
   * Расписание повторения тем: только сроки и счётчики, без содержимого ответов.
   * Выводится из завершённых занятий (lib/review/topics.ts).
   */
  reviewStates?: import('./review/intervals.ts').ReviewState[];
  /**
   * Календарный день (`YYYY-MM-DD`), в который уже был повтор.
   * Не больше одного повтора в день: повтор не должен вытеснять новый день.
   */
  reviewDay?: string;
};

/* ------------------------- игровое состояние ребёнка ------------------------- */

export type PlayerStats = {
  days: number;
  tasks: number;
  correctTasks: number;
  scenarios: number;
  goodScenarios: number;
  bestCombo: number;
  perfectDays: number;
  minutes: number;
};

export type MissionState = {
  /** номер дня программы, к которому относятся миссии */
  day: number;
  ids: string[];
  progress: Record<string, number>;
  claimed: string[];
};

export type Equipped = {
  head: string | null;
  body: string | null;
  pet: string | null;
  room: string | null;
};

export type PlayerState = {
  profileId: string;
  xp: number;
  coins: number;
  stars: number;
  streak: number;
  bestStreak: number;
  lastActiveDay: string;
  badges: string[];
  inventory: string[];
  equipped: Equipped;
  missions: MissionState;
  family?: import('./engine/family').FamilyState;
  stats: PlayerStats;
  startedAt: number;
};

export type WeeklyReport = {
  weekStart: number;
  minutes: number;
  sessions: number;
  tasksDone: number;
  assistedTasks: number;
  scenariosDone: number;
  supportPracticesDone: number;
  skills: { skill: SkillId; label: string; delta: number | null; ability: number }[];
  win: string;
  growth: string;
  home: string;
  question: string;
  scenarioNotes: { scenarioId: string; text: string }[];
  program: {
    week: number;
    weekTitle: string;
    day: number;
    dayTheme: string;
    completedDays: number;
    totalDays: number;
    finished: boolean;
  };
  player: {
    level: number;
    levelTitle: string;
    xp: number;
    coins: number;
    stars: number;
    badges: number;
    days: number;
    perfectDays: number;
  };
};

/** Состояние платежа, созданного на сервере; не содержит платёжных реквизитов. */
export type Payment = {
  id: string;
  profileId: string;
  plan: 'month';
  amount: string;
  currency: 'RUB';
  days: number;
  status: 'creating' | 'pending' | 'succeeded' | 'canceled';
  providerId?: string;
  confirmationUrl?: string;
  createdAt: number;
  appliedAt?: number;
};
