import type { SessionStore } from '../engine/session';
import type { PlayerState, Profile, ProgramState, Session, SkillState } from '../types';
import { emptyStats } from '../gamification';

export type ProfileSnapshot = {
  profile: Profile;
  skills: (SkillState & { profileId: string })[];
  sessions: Session[];
  programStates: ProgramState[];
  playerStates: PlayerState[];
};

/** Synchronous isolated working copy for the existing domain engine, discarded on DB rollback. */
export function makeSessionMemory(input: ProfileSnapshot): { state: ProfileSnapshot; store: SessionStore } {
  const state = structuredClone(input);
  const owned = (id: string) => { if (id !== state.profile.id) throw new Error('Cross-profile access forbidden'); };
  const memory: SessionStore = {
    transaction: fn => fn(),
    profile: id => id === state.profile.id ? state.profile : undefined,
    skills: id => { owned(id); return state.skills.filter(s => s.profileId === id); },
    addSkill: skill => { owned(skill.profileId); state.skills.push(skill); },
    updateSkill: (id, skill, patch) => { owned(id); const found = state.skills.find(s => s.profileId === id && s.skill === skill); if (found) Object.assign(found, patch); return found; },
    sessions: id => { owned(id); return state.sessions.filter(s => s.profileId === id); },
    addSession: session => { owned(session.profileId); state.sessions.push(session); },
    getSession: id => state.sessions.find(s => s.id === id),
    updateSession: (id, patch) => { const found = state.sessions.find(s => s.id === id); if (found) Object.assign(found, patch); return found; },
    programState: id => {
      owned(id); let found = state.programStates.find(p => p.profileId === id);
      if (!found) { found = { profileId: id, completedDays: 0, lastDayIndex: 0, startedAt: Date.now() }; state.programStates.push(found); }
      return found;
    },
    setProgramState: program => { owned(program.profileId); const i = state.programStates.findIndex(p => p.profileId === program.profileId); if (i < 0) state.programStates.push(program); else state.programStates[i] = program; },
    playerState: id => {
      owned(id); let player = state.playerStates.find(p => p.profileId === id);
      if (!player) {
        player = { profileId: id, xp: 0, coins: 0, stars: 0, streak: 0, bestStreak: 0, lastActiveDay: '', badges: [], inventory: [],
          equipped: { head: null, body: null, pet: null, room: null }, missions: { day: 0, ids: [], progress: {}, claimed: [] }, stats: emptyStats(), startedAt: Date.now() };
        state.playerStates.push(player);
      } else {
        // Match legacy store compatibility defaults without mutating persisted data until commit.
        player.stats = { ...emptyStats(), ...(player.stats ?? {}) };
        player.equipped = { head: null, body: null, pet: null, room: null, ...(player.equipped as Partial<typeof player.equipped> ?? {}) };
        player.missions = { day: 0, ids: [], progress: {}, claimed: [], ...(player.missions as Partial<typeof player.missions> ?? {}) };
        player.badges ??= []; player.inventory ??= [];
      }
      return player;
    },
    setPlayerState: player => { owned(player.profileId); const i = state.playerStates.findIndex(p => p.profileId === player.profileId); if (i < 0) state.playerStates.push(player); else state.playerStates[i] = player; },
  };
  return { state, store: memory };
}
