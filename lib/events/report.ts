import type { SkillId } from '../types';
import type { EventJournal, LearningEvent, StoredEvent } from './journal';

/**
 * Отчёт поверх журнала событий.
 *
 * Правила, которые нельзя нарушать:
 * - считаются только завершённые занятия (событие `session_completed`), а не
 *   «нажатия»: незавершённая сессия не попадает в отчёт;
 * - отчёт объясняет, откуда взялось число (`source`), и что он НЕ утверждает;
 * - никаких выводов о личности ребёнка, «стал добрее», диагнозов и рейтингов;
 * - отметки чувств в журнал не попадают вовсе, поэтому их в отчёте нет.
 */

export type ReportSource = {
  /** Тип события-источника и его версия. */
  event: LearningEvent['type'];
  version: 1;
  /** Сколько записей журнала использовано. */
  records: number;
};

export type SkillFact = {
  skill: SkillId;
  /** Доля верных ответов среди обычных заданий навыка, 0..1, или null, если данных нет. */
  accuracy: number | null;
  tasks: number;
  /** Задания, которые не должны влиять на оценку: повторный показ, подсказка, восстановление. */
  excluded: number;
};

export type EventReport = {
  /** Период, за который построен отчёт. */
  from: number;
  to: number;
  student: {
    sessions: number;
    minutes: number;
    tasks: number;
    /** Задания, исключённые из показателей точности, но показанные как работа. */
    excludedTasks: number;
    stories: number;
    practices: number;
    skippedPractices: number;
    stars: number;
  };
  skills: SkillFact[];
  sources: ReportSource[];
  /** Строки, которые нельзя печатать как выводы. Используются в интерфейсе как ограничения. */
  limits: string[];
};

export type EventReportOptions = {
  /** Окно в днях; по умолчанию — неделя. */
  days?: number;
  /** «Сейчас» для тестов; не влияет на данные. */
  now?: number;
};

export const REPORT_LIMITS = [
  'Показатели считаются только по завершённым занятиям; незаконченная тренировка в отчёт не попадает.',
  'Это игровые показатели внимания и памяти, а не диагностика и не оценка личности ребёнка.',
  'Задания с повторным показом, подсказкой или восстановлением не влияют на точность, но считаются выполненной работой.',
  'Отметки чувств и ответы историй в отчёт не входят: журнал не хранит их содержимое.',
] as const;

const SKILLS: SkillId[] = ['attention', 'working_memory', 'flexibility', 'inhibition', 'planning', 'logic'];

/** Навык можно восстановить из типа задания: событие хранит только вид задания. */
const KIND_SKILL: Record<string, SkillId> = {
  choice: 'attention',
  gonogo: 'inhibition',
  cards: 'flexibility',
  // «Правило меняется» — тоже гибкость, хотя вид задания другой.
  'switch-rounds': 'flexibility',
  finddiff: 'attention',
  digits: 'working_memory',
  'symbol-memory': 'working_memory',
  memory: 'working_memory',
  order: 'planning',
};

export function skillForTaskKind(kind: string): SkillId | null {
  return KIND_SKILL[kind] ?? null;
}

/**
 * Считает отчёт только по разрешённым событиям. Никакие поля профиля сюда
 * не подмешиваются: если событий нет, отчёт честно пуст.
 */
export function buildEventReport(journal: EventJournal, ownerId: string, profileId: string, options: EventReportOptions = {}): EventReport {
  const now = options.now ?? Date.now();
  const days = options.days ?? 7;
  const from = now - days * 24 * 60 * 60 * 1000;
  const events = journal.list(ownerId, profileId).filter(e => e.at >= from && e.at <= now);
  const byType = (type: LearningEvent['type']) => events.filter(e => e.event.type === type);
  const completed = byType('session_completed');
  // Завершённые сессии: id сессии берётся из ключа идемпотентности «сессия:шаг:действие».
  const completedSessions = new Set<string>();
  const sessionOf = (e: StoredEvent) => e.dedupeKey.split(':')[0] ?? '';
  for (const e of completed) completedSessions.add(sessionOf(e));

  let minutes = 0, stars = 0, tasks = 0, excluded = 0, stories = 0, practices = 0, skipped = 0;
  const perSkill = new Map<SkillId, { correct: number; total: number; excluded: number }>();
  for (const s of SKILLS) perSkill.set(s, { correct: 0, total: 0, excluded: 0 });

  for (const e of events) {
    const event = e.event;
    if (event.type === 'session_completed') { minutes += Math.max(1, Math.round(event.seconds / 60)); stars += event.stars; }
    if (event.type === 'story_answered') stories += 1;
    if (event.type === 'practice_answered') { practices += 1; if (event.skipped) skipped += 1; }
    if (event.type === 'task_answered') {
      tasks += 1;
      // Навык берётся из события; для старых записей без него — из вида задания.
      const skill = event.taskSkill ?? skillForTaskKind(event.taskKind);
      const bucket = skill ? perSkill.get(skill) : undefined;
      if (!bucket) continue;
      if (event.assisted) { bucket.excluded += 1; excluded += 1; continue; }
      bucket.total += 1;
      if (event.correct) bucket.correct += 1;
    }
  }

  const skills = SKILLS.map<SkillFact>(skill => {
    const bucket = perSkill.get(skill)!;
    return {
      skill,
      accuracy: bucket.total ? Math.round((bucket.correct / bucket.total) * 100) / 100 : null,
      tasks: bucket.total,
      excluded: bucket.excluded,
    };
  });

  const sources: ReportSource[] = (['session_completed', 'task_answered', 'story_answered', 'practice_answered'] as const)
    .map(type => ({ event: type, version: 1 as const, records: byType(type).length }))
    .filter(source => source.records > 0);

  return {
    from,
    to: now,
    student: { sessions: completedSessions.size, minutes, tasks, excludedTasks: excluded, stories, practices, skippedPractices: skipped, stars },
    skills,
    sources,
    limits: [...REPORT_LIMITS],
  };
}
