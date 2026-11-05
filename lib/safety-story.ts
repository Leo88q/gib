import type { AgeBand } from './types.ts';
import type { SafetyStory } from './content/safety-story.ts';

/**
 * Разговор по опасной ситуации.
 *
 * Это не задание и не тест: выбор не сохраняется на сервере, не влияет на
 * награды и не оценивается. Функции чистые, чтобы экран оставался простым,
 * а правила — проверяемыми тестом.
 */

export type SafetyStep = {
  storyId: string;
  nodeId: string;
  text: string;
  choices: { label: string; next: string; safe?: boolean }[];
  ending: boolean;
};

/** Первая сцена истории. */
export function startSafetyStory(story: SafetyStory): SafetyStep {
  return toStep(story, 'start');
}

/** Переход по выбранному варианту. Неизвестный id — ошибка, а не молчаливый тупик. */
export function chooseSafetyOption(story: SafetyStory, nodeId: string, choiceIndex: number): SafetyStep {
  const node = story.nodes[nodeId];
  if (!node) throw new Error(`safety_node_missing:${nodeId}`);
  const choice = node.choices[choiceIndex];
  if (!choice) throw new Error(`safety_choice_missing:${nodeId}:${choiceIndex}`);
  return toStep(story, choice.next);
}

function toStep(story: SafetyStory, nodeId: string): SafetyStep {
  const node = story.nodes[nodeId];
  if (!node) throw new Error(`safety_node_missing:${nodeId}`);
  return {
    storyId: story.id,
    nodeId,
    text: node.text,
    choices: node.choices.map(({ label, next, safe }) => ({ label, next, safe })),
    ending: node.ending === true,
  };
}

/**
 * Какие истории показать этому возрасту. Текст нейтральный, поэтому разница
 * только в порядке: младшим — про незнакомца и найденную вещь, старшим —
 * про переписку и чат.
 */
export function safetyStoriesFor(band: AgeBand, stories: SafetyStory[]): SafetyStory[] {
  const suitable = stories.filter((story) => story.bands.includes(band));
  const order: Record<AgeBand, string[]> = {
    '5-7': ['stranger_contact', 'found_something', 'match_stolen', 'secret_meeting'],
    '8-10': ['stranger_contact', 'match_stolen', 'found_something', 'secret_meeting'],
    '11-13': ['secret_meeting', 'match_stolen', 'stranger_contact', 'found_something'],
  };
  const rank = order[band];
  return [...suitable].sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id));
}

/**
 * Завершающая фраза для взрослого. Никаких обещаний и оценок: только
 * напоминание, что делать дальше и что ребёнок может остановиться.
 */
export const SAFETY_CLOSING = 'Спасибо, что прошёл этот разговор. Если похожее случится по-настоящему, можно остановиться и позвать взрослого, которому ты доверяешь. Если один взрослый не помог — можно обратиться к другому.';
