import type { AgeBand, CompetencyId, Session } from '../types';
import { SKILL_BY_ID, skillsForCompetency } from '../content/skills-catalog';
import { STORY_SKILLS } from '../content/story-skills';

/**
 * Что ребёнок видит про свои гибкие навыки.
 *
 * Три правила, из которых следует всё остальное.
 *
 * 1. Это не оценка. Навык либо встречался в пройденных историях, либо пока
 *    нет. Никаких «уровней», «процентов освоения» и «баллов за эмпатию»:
 *    ребёнок не должен соревноваться в доброте и не должен узнавать, что он
 *    «слабый» в чём-то. Поэтому здесь только `met: boolean`.
 *
 * 2. Видно и то, что ещё не встречалось. Карта из одних галочек превращается
 *    в отчёт о достижениях; пустая ячейка честнее и оставляет интерес.
 *
 * 3. Названия — по возрасту. Одно и то же умение для шести и двенадцати лет
 *    называется по-разному, и человеку показывается его формулировка.
 *
 * Повтор истории не увеличивает счётчик: второй раз та же сцена не делает
 * навык «более освоенным», иначе карта превращается в систему очков.
 */

export type SkillProgress = {
  id: string;
  /** Название для взрослого — используется в служебном выводе. */
  title: string;
  /** Формулировка под возраст ребёнка. */
  label: string;
  /** Встречался ли навык в завершённых историях. */
  met: boolean;
  /** Сколько разных историй его тренировали. Ноль, если не встречался. */
  stories: number;
};

export type CompetencyProgress = {
  id: CompetencyId;
  title: string;
  /** Формулировка для ребёнка, а не название компетенции из методички. */
  label: string;
  met: number;
  total: number;
  skills: SkillProgress[];
};

/**
 * Названия компетенций для ребёнка. Не «Самопознание» и не «Эмоциональный
 * интеллект»: это слова из отчёта взрослого, а не из разговора с ребёнком.
 */
export const CHILD_COMPETENCY_LABELS: Record<CompetencyId, string> = {
  self_awareness: 'Понимать себя',
  self_regulation: 'Справляться с собой',
  empathy: 'Замечать других',
  relationships: 'Быть с другими',
  decision_making: 'Выбирать и решать',
  creative_thinking: 'Придумывать',
  growth_mindset: 'Пробовать и не сдаваться',
};

/** Пять слов, которыми ребёнок может описать своё движение. */
export type SkillMood = 'start' | 'moving' | 'many';

export function skillMap(profileId: string, sessions: readonly Session[], band: AgeBand): CompetencyProgress[] {
  // Какие истории ребёнок действительно прошёл до конца.
  const finished = new Set<string>();
  for (const session of sessions) {
    if (session.profileId !== profileId) continue;
    if (!Number.isFinite(session.finishedAt) || (session.finishedAt ?? 0) <= 0) continue;
    const scenarioId = session.scenario?.scenarioId;
    if (typeof scenarioId === 'string' && scenarioId) finished.add(scenarioId);
  }

  // Истории, которые тренировали каждый навык.
  const storiesBySkill = new Map<string, Set<string>>();
  for (const scenarioId of finished) {
    for (const skillId of STORY_SKILLS[scenarioId]?.skills ?? []) {
      const set = storiesBySkill.get(skillId) ?? new Set<string>();
      set.add(scenarioId);
      storiesBySkill.set(skillId, set);
    }
  }

  const competencies: CompetencyId[] = [
    'self_awareness', 'self_regulation', 'empathy', 'relationships',
    'decision_making', 'creative_thinking', 'growth_mindset',
  ];

  return competencies.map(competency => {
    const skills: SkillProgress[] = skillsForCompetency(competency).map(skill => {
      const stories = storiesBySkill.get(skill.id)?.size ?? 0;
      return {
        id: skill.id,
        title: skill.title,
        label: skill.child[band],
        met: stories > 0,
        stories,
      };
    });
    return {
      id: competency,
      title: CHILD_COMPETENCY_LABELS[competency],
      label: CHILD_COMPETENCY_LABELS[competency],
      met: skills.filter(skill => skill.met).length,
      total: skills.length,
      skills,
    };
  });
}

/**
 * Одна фраза про состояние карты. Без восклицаний и без похвалы: ребёнок не
 * должен читать это как оценку себя.
 */
export function skillMood(competencies: readonly CompetencyProgress[]): { mood: SkillMood; text: string } {
  const met = competencies.reduce((sum, competency) => sum + competency.met, 0);
  const total = competencies.reduce((sum, competency) => sum + competency.total, 0);
  if (met === 0) {
    return { mood: 'start', text: 'Здесь появятся умения из историй, которые ты пройдёшь. Пока ни одного.' };
  }
  if (met >= Math.ceil(total * 0.75)) {
    return { mood: 'many', text: `Встречалось ${met} из ${total} умений. Можно возвращаться к историям и замечать новые.` };
  }
  return { mood: 'moving', text: `Встречалось ${met} из ${total} умений. Пропусков здесь нет — просто ещё не все истории пройдены.` };
}

/** Служебная проверка: навык принадлежит ровно одной компетенции. */
export function skillOwner(skillId: string): CompetencyId | undefined {
  return SKILL_BY_ID[skillId]?.competency;
}
