import { SAFETY_STORY } from '../lib/content/safety-story.ts';
import { MINI_STORIES } from '../lib/content/mini-stories.ts';
import type { StoryNode } from '../lib/content/safety-story.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
for (const [title, nodes] of Object.entries({ safety: SAFETY_STORY, ...Object.fromEntries(Object.entries(MINI_STORIES).map(([id, story]) => [id, story.nodes])) }) as [string, Record<string, StoryNode>][]) {
  check(nodes.start, `${title}: нет начала`);
  for (const [id, node] of Object.entries(nodes)) {
    check(node.text && node.choices.length, `${title}: пустая сцена ${id}`);
    for (const choice of node.choices) check(choice.label && nodes[choice.next], `${title}: нет перехода ${id} → ${choice.next}`);
  }
  const reachable = new Set<string>();
  const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); nodes[id].choices.forEach(c => visit(c.next)); };
  visit('start');
  check(reachable.size === Object.keys(nodes).length, `${title}: есть недостижимая сцена`);
  for (const id of reachable) {
    const seen = new Set<string>();
    const canFinish = (node: string): boolean => {
      if (nodes[node].ending) return true;
      if (seen.has(node)) return false;
      seen.add(node);
      return nodes[node].choices.some(c => canFinish(c.next));
    };
    check(canFinish(id), `${title}: нет пути к завершению из ${id}`);
  }
  console.log(`  ok  ${title}: переходы и путь к завершению`);
}

const { AGE_REFLECTIONS } = await import('../lib/content/age-reflection.ts');
const competencies = ['self_awareness', 'self_regulation', 'empathy', 'relationships', 'decision_making', 'creative_thinking', 'growth_mindset'] as const;
for (const competency of competencies) {
  const prompts = AGE_REFLECTIONS[competency];
  check(['5-7','8-10','11-13'].every(b => typeof prompts[b as keyof typeof prompts] === 'string' && prompts[b as keyof typeof prompts].length > 10), `${competency}: отсутствует возрастной вопрос`);
  check(new Set(Object.values(prompts)).size === 3, `${competency}: возрастные вопросы не различаются`);
}
console.log('  ok вопросы для 7 компетенций адаптированы для трёх возрастных линеек');
