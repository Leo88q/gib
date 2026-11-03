import { createMachine, createActor } from 'xstate';
import type { DayEvent, DayStage } from './day-flow.ts';

/** Only models allowed stage order; durable state and idempotency stay with the caller. */
export const dayMachine = createMachine({
  id: 'gib-day', initial: 'checkin',
  states: {
    checkin: { on: { checkin_done: 'pause' } },
    pause: { on: { pause_done: 'choose_story', pause_skipped: 'choose_story' } },
    choose_story: { on: { story_selected: 'story' } },
    story: { on: { story_done: 'practice', story_skipped: 'practice' } },
    practice: { on: { practice_done: 'reflection', practice_skipped: 'reflection' } },
    reflection: { on: { reflection_done: 'completed', reflection_skipped: 'completed' } },
    completed: { type: 'final' },
  },
});
export function nextDayStage(stage: DayStage, event: DayEvent): DayStage | null {
  const snapshot = dayMachine.resolveState({ value: stage });
  const actor = createActor(dayMachine, { snapshot });
  actor.start();
  const accepts = actor.getSnapshot().can(event);
  if (accepts) actor.send(event);
  const next = actor.getSnapshot().value;
  actor.stop();
  return accepts && typeof next === 'string' ? next as DayStage : null;
}
