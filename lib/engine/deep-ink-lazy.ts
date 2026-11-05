import { Compiler, Story } from 'inkjs/full';
import type { AgeBand } from '../types.ts';
import type { Scenario, ScenarioVariant } from '../content/softskills.ts';
import { ALL_DEEP_FOLLOWUPS, type StoryFollowUp } from '../content/program/all-deep-followups.ts';

/**
 * Второй шаг истории без заранее собранных файлов.
 *
 * Для историй, у которых нет готового Ink-дерева в
 * `lib/content/ink/deep`, дерево собирается из тех же текстов, что лежат в
 * контенте: ситуация, три варианта с пояснениями, продолжение и две развязки.
 * Это те же данные, что для остальных историй, только собранные на месте.
 *
 * Дерево кэшируется по ключу «история + возраст»: компиляция занимает
 * десятки миллисекунд, и повторять её на каждый экран незачем. Кэш ограничен
 * сотней записей, потому что он живёт в процессе сервера.
 */

/** Тот же ограничитель, что в ручном компиляторе: Ink-разметка не должна ломаться. */
function safeText(value: string): string {
  if (!value || /[\n\r[\]{}<>#~\\]/.test(value) || /^\s*([*+\-=]|VAR |LIST |->)/.test(value)) {
    throw new Error('invalid_ink_text');
  }
  return value;
}

export function deepInkSource(scenario: Scenario, band: AgeBand, followups: readonly StoryFollowUp[]): string {
  const variant = scenario.variants[band];
  if (!variant || variant.options.length !== 3) throw new Error('deep_source_options');
  if (followups.length !== 3) throw new Error('deep_source_followups');
  const branches = variant.options.map((option, index) => {
    const followUp = followups[index];
    if (followUp.choices.length !== 2 || followUp.endings.length !== 2) throw new Error('deep_source_branch');
    const leaves = followUp.choices
      .map((choice, branch) => `    ** [${safeText(choice)}]\n        ${safeText(followUp.endings[branch])}\n        -> END`)
      .join('\n');
    return `* [${safeText(option.text)}]\n    ${safeText(option.note)} ${safeText(followUp.prompt)}\n${leaves}`;
  });
  return `${safeText(variant.text)}\n\n${branches.join('\n')}\n`;
}

const cache = new Map<string, string>();
const MAX_CACHE = 100;

/** Ink-дерево для истории и возраста; null, если продолжений для неё нет. */
export function lazyDeepInk(scenario: Scenario, band: AgeBand): string | null {
  const followups = ALL_DEEP_FOLLOWUPS[scenario.id]?.[band];
  if (!followups) return null;
  const key = `${scenario.id}\u0000${band}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiler = new Compiler(deepInkSource(scenario, band, followups));
  const story = compiler.Compile();
  if (compiler.errors.length) throw new Error('deep_ink_compile');
  const json = story.ToJson();
  if (typeof json !== 'string') throw new Error('deep_ink_serialize');
  // Проверяем дерево до кэширования: битое дерево не должно попасть в сессию.
  const check = new Story(json);
  let text = '';
  while (check.canContinue) text += check.Continue();
  if (text.trim() !== scenario.variants[band].text) throw new Error('deep_ink_initial_mismatch');
  if (check.currentChoices.length !== 3) throw new Error('deep_ink_choices_mismatch');
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, json);
  return json;
}

/** Только для тестов: сбросить кэш и проверить, что дерево собирается заново. */
export function clearLazyDeepInkCache(): void {
  cache.clear();
}

/** Глубина есть, если её можно собрать: ручное дерево или продолжения. */
export function hasDeepInk(scenario: Scenario, band: AgeBand): boolean {
  return ALL_DEEP_FOLLOWUPS[scenario.id]?.[band] !== undefined;
}

/** Продолжения для истории — то, что видит клиент до выбора второго шага. */
export function followUpsFor(id: string, band: AgeBand): StoryFollowUp[] | undefined {
  return ALL_DEEP_FOLLOWUPS[id]?.[band];
}

/** Совместимость с типом варианта: дерево, которое ожидает валидатор. */
export function deepInkVariantFor(scenario: Scenario, band: AgeBand): ScenarioVariant['deepInk'] | undefined {
  const json = lazyDeepInk(scenario, band);
  return json ? { version: 1, json } : undefined;
}
