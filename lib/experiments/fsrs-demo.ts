import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

/** Synthetic fixed example: does not accept or persist child data or affect game scheduling. */
export function syntheticFsrsComparison() {
  const start = new Date('2026-01-01T12:00:00.000Z');
  const scheduler = fsrs({ enable_fuzz: false, enable_short_term: false });
  let card = createEmptyCard(start);
  const rows: { attempt: number; day: string; fsrsNext: string; fixedNext: string }[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const date = new Date(start.getTime() + attempt * 7 * 86400000);
    card = scheduler.next(card, date, Rating.Good).card;
    rows.push({ attempt: attempt + 1, day: date.toISOString(), fsrsNext: card.due.toISOString(), fixedNext: new Date(date.getTime() + 7 * 86400000).toISOString() });
  }
  return rows;
}
