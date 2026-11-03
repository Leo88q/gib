import type { CompetencyId, Session } from '../types';

/** Facts about completed game content, not an assessment of the child. */
export type PracticeTopic = { id: CompetencyId; title: string; stories: number; practices: number };
const themes: readonly { id: CompetencyId; title: string }[] = [
  { id: 'self_awareness', title: 'Замечать и выбирать' },
  { id: 'self_regulation', title: 'Пауза и забота о себе' },
  { id: 'empathy', title: 'Замечать других' },
  { id: 'relationships', title: 'Общаться и договариваться' },
  { id: 'decision_making', title: 'Искать решения' },
  { id: 'creative_thinking', title: 'Придумывать идеи' },
  { id: 'growth_mindset', title: 'Пробовать новое' },
];
export function practiceMap(profileId: string, sessions: readonly Session[]): PracticeTopic[] {
  const topics = themes.map(t => ({ ...t, stories: 0, practices: 0 }));
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  for (const session of sessions) {
    if (session.profileId !== profileId || !Number.isFinite(session.finishedAt) || (session.finishedAt ?? 0) <= 0) continue;
    const topic = session.scenario && byId.get(session.scenario.competency);
    if (!topic) continue;
    topic.stories++;
    if (session.supportPracticeCompleted === true) topic.practices++;
  }
  return topics;
}
