import { createActor, createMachine } from 'xstate';

/** Shared stage order. The two private screens never contribute data to the durable snapshot. */
export type JourneyStage = 'checkin' | 'pause' | 'choose_story' | 'story' | 'practice' | 'activities' | 'reflection' | 'completed';
export type JourneyEvent =
  | { type: 'checkin_done' } | { type: 'pause_done' } | { type: 'pause_skipped' }
  | { type: 'story_selected' } | { type: 'story_done' }
  | { type: 'practice_done' } | { type: 'practice_skipped' }
  | { type: 'activities_done' } | { type: 'reflection_done' } | { type: 'reflection_skipped' };
export const journeyMachine = createMachine({
  id: 'gib-journey-v2', initial: 'checkin', states: {
    checkin: { on: { checkin_done: 'pause' } },
    pause: { on: { pause_done: 'choose_story', pause_skipped: 'choose_story' } },
    choose_story: { on: { story_selected: 'story' } },
    story: { on: { story_done: 'practice' } },
    practice: { on: { practice_done: 'activities', practice_skipped: 'activities' } },
    activities: { on: { activities_done: 'reflection' } },
    reflection: { on: { reflection_done: 'completed', reflection_skipped: 'completed' } },
    completed: { type: 'final' },
  },
});
/** Rehydrate only the public stage, not private local selections. */
export function nextJourneyStage(stage: JourneyStage, event: JourneyEvent): JourneyStage | null {
  const actor = createActor(journeyMachine, { snapshot: journeyMachine.resolveState({ value: stage }) });
  actor.start(); const accepts=actor.getSnapshot().can(event); if(accepts)actor.send(event);
  const next=actor.getSnapshot().value; actor.stop();
  return accepts && typeof next==='string' ? next as JourneyStage : null;
}
