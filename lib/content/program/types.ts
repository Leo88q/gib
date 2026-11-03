import type { SkillId, CompetencyId } from '../../types';

export type DayPlan = {
  /** 1..5 — тренировочный день внутри недели */
  day: number;
  /** Короткое название дня для ребёнка и родителя */
  theme: string;
  /** Сценарий мягкого навыка этого дня */
  scenarioId: string;
  /** Главный навык дня */
  focus: SkillId;
  /** Три когнитивных навыка в тренировке этого дня */
  skills: SkillId[];
  /** Что родитель может заметить в этот день */
  parentGoal: string;
};

export type WeekPlan = {
  /** 1..12 */
  week: number;
  title: string;
  subtitle: string;
  /** Основная компетенция недели */
  competency: CompetencyId;
  /** Когнитивные навыки, которые неделя усиливает */
  focusSkills: SkillId[];
  /** Цель недели для родителя */
  parentNote: string;
  /** Идеи для дома на эту неделю */
  homeIdeas: string[];
  /** Родительский вопрос по итогам недели */
  weekQuestion: string;
  days: DayPlan[];
};

export const SKILL_LABEL: Record<SkillId, string> = {
  attention: 'Внимание',
  working_memory: 'Рабочая память',
  flexibility: 'Гибкость',
  inhibition: 'Торможение',
  planning: 'Планирование',
  logic: 'Логика',
};

export const COMPETENCY_LABEL: Record<CompetencyId, string> = {
  self_awareness: 'Самопознание',
  self_regulation: 'Саморегуляция',
  empathy: 'Эмпатия',
  relationships: 'Навыки отношений',
  decision_making: 'Ответственные решения',
  creative_thinking: 'Творческое мышление',
  growth_mindset: 'Мышление роста',
};
