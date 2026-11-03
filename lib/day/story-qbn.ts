import SimpleQBN from 'simple-qbn';
import type { AgeBand } from '../types.ts';
import type { StoryCard } from './story-deck.ts';

/** Server constructs fixed predicates, never accepts queries, scores or feelings from a client. */
export function qbnAllowsCard(card: StoryCard, dayIndex: number, band: AgeBand, seen: ReadonlySet<string>): boolean {
  const state = new SimpleQBN.State();
  state.set('dayMatches', card.dayIndex === dayIndex);
  state.set('ageAllowed', card.bands.includes(band));
  state.set('notRepeated', Boolean(card.repeatable || !seen.has(card.id)));
  state.set('prerequisitesMet', (card.requires ?? []).every(id => seen.has(id)));
  const rule = new SimpleQBN.Card(card.id, [
    { dayMatches: true }, { ageAllowed: true }, { notRepeated: true }, { prerequisitesMet: true },
  ]);
  return rule.isAvailable(state);
}
