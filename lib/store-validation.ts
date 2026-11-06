import { validateInkVariant } from './engine/ink-snapshot.ts';
import { validateDeepInkVariant } from './engine/deep-ink.ts';
import type { ScenarioVariant } from './content/softskills.ts';
import { validFamilyState } from './engine/family.ts';
import { validateEvent } from './events/journal.ts';
import { validCheckIn, validPreferences, MAX_CHECKINS } from './feelings/state.ts';
import { validParentPin } from './family/roles.ts';
/** Partial structural validation. It intentionally does not claim full data integrity. */
export const STORE_COLLECTIONS = ['profiles', 'skills', 'sessions', 'subs', 'programStates', 'playerStates', 'payments', 'events'] as const;
/**
 * PIN взрослого хранится рядом с коллекциями, но не входит в `STORE_COLLECTIONS`:
 * это состояние аккаунта, а не данные ребёнка, и в перенос в PostgreSQL оно не идёт.
 */
type Collection = typeof STORE_COLLECTIONS[number];
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const arrayIfPresent = (value: unknown) => value === undefined || Array.isArray(value);

function storySnapshot(value: unknown, scenarioId: unknown): boolean {
  if (!object(value) || value.id !== scenarioId || !text(value.competency) || !text(value.skillLabel) || !object(value.variants)) return false;
  const variants = value.variants;
  return ['5-7', '8-10', '11-13'].every(band => {
    const v = variants[band];
    return object(v) && text(v.title) && text(v.text) && Array.isArray(v.options) && v.options.length > 0 && v.options.every(o => object(o) && text(o.text) && text(o.note) && (o.quality === undefined || ['good', 'partial', 'bad'].includes(String(o.quality)))) && (v.ink === undefined || validateInkVariant(v as ScenarioVariant)) && (v.deepInk === undefined || validateDeepInkVariant(v as ScenarioVariant));
  });
}

function supportSnapshot(value: unknown): boolean {
  if (!object(value) || value.kind !== 'social-practice' || value.taskId !== 'support-practice' || !text(value.title) || !text(value.prompt) || !Array.isArray(value.rounds) || value.rounds.length !== 3) return false;
  return value.rounds.every(r => object(r) && text(r.prompt) && Array.isArray(r.options) && r.options.length === 3 && r.options.every(text));
}

/** Validate before reading, publishing a backup, importing or committing. Does not modify input. */
export function validateStore(value: unknown): void {
  if (!object(value)) throw new Error('Invalid store: expected an object');
  if (!Array.isArray(value.profiles) || !Array.isArray(value.sessions)) throw new Error('Invalid store: required collections missing');
  for (const key of STORE_COLLECTIONS) {
    const list = value[key];
    if (list === undefined) continue; // compatibility with older snapshots
    if (!Array.isArray(list)) throw new Error(`Invalid store collection: ${key}`);
    const seen = new Set<string>();
    for (const row of list) {
      if (!object(row)) throw new Error(`Invalid store record: ${key}`);
      const id = key === 'profiles' || key === 'sessions' || key === 'payments' || key === 'events' ? row.id : row.profileId;
      if (!text(id) || (key !== 'profiles' && !text(row.profileId))) throw new Error(`Invalid store identity: ${key}`);
      if (key === 'profiles' && !text(row.parentId)) throw new Error('Invalid store identity: profiles');
      if (key === 'skills' && !text(row.skill)) throw new Error('Invalid store identity: skills');
      // Дедупликация событий проверяется по ключу, а не только по id: логика журнала опирается на «одно событие на шаг».
      const unique = key === 'skills' ? JSON.stringify([id, row.skill]) : key === 'events' ? String(row.dedupeKey ?? id) : id;
      if (seen.has(unique as string)) throw new Error(`Duplicate store identity: ${key}`);
      seen.add(unique as string);
      validateRecord(key, row);
    }
  }
  // PIN взрослого: только владелец и корректная запись, без повторов.
  const pins = (value as { parentPins?: unknown }).parentPins;
  if (pins !== undefined) {
    if (!Array.isArray(pins)) throw new Error('Invalid store collection: parentPins');
    const owners = new Set<string>();
    for (const row of pins) {
      if (!object(row) || !text(row.parentId) || !validParentPin(row.pin)) throw new Error('Invalid parent pin record');
      const owner = String(row.parentId);
      if (owners.has(owner)) throw new Error('Duplicate store identity: parentPins');
      owners.add(owner);
    }
  }
}
function validateRecord(key: Collection, row: Record<string, unknown>): void {
  if (key === 'sessions') {
    if (!arrayIfPresent(row.tasks) || !arrayIfPresent(row.plan)) throw new Error('Invalid session arrays');
    if (row.tasks !== undefined && !(row.tasks as unknown[]).every(object)) throw new Error('Invalid task records');
    if (row.runtime !== undefined) {
      const r = row.runtime;
      if (!object(r) || r.sessionId !== row.id || r.profileId !== row.profileId || !Array.isArray(r.items) || !Array.isArray(r.plan) ||
          !Number.isInteger(r.index) || (r.index as number) < 0 || (r.index as number) >= r.items.length || r.plan.length !== r.items.length ||
          !r.items.every(item => object(item) && (item.type === 'task' ? object(item.instance) : item.type === 'scenario' && text(item.scenarioId) && Array.isArray(item.order))) ||
          !arrayIfPresent(r.taskAnswers) || !arrayIfPresent(r.practiceSteps)) throw new Error('Invalid session runtime');
    }
    if (object(row.runtime) && Array.isArray(row.runtime.items) && !row.runtime.items.every(item => !object(item) || item.type !== 'scenario' || item.content === undefined || storySnapshot(item.content, item.scenarioId))) throw new Error('Invalid story content');
    if (row.supportPracticeCompleted !== undefined && typeof row.supportPracticeCompleted !== 'boolean') throw new Error('Invalid support practice result');
    if (object(row.runtime)) {
      const r = row.runtime;
      if (r.storyFlow !== undefined) {
        const flow = r.storyFlow;
        const plan = r.plan as unknown[]; const items = r.items as unknown[];
        const si = plan.findIndex(p => object(p) && p.type === 'scenario');
        const pi = plan.findIndex(p => object(p) && p.type === 'task' && p.taskId === 'support-practice');
        if (!object(flow) || Object.keys(flow).sort().join(',') !== 'stage,version' || ![1, 2].includes(flow.version as number) || (flow.version === 2 && (si !== 0 || !Number.isInteger(r.dayIndex) || (r.dayIndex as number) < 0 || (r.dayIndex as number) >= 60)) || si < 0 || pi !== si + 1 || plan.filter(p => object(p) && p.type === 'scenario').length !== 1 || plan.filter(p => object(p) && p.type === 'task' && p.taskId === 'support-practice').length !== 1 || !object(items[si]) || items[si].type !== 'scenario' || !object(items[pi]) || !object(items[pi].instance) || items[pi].instance.kind !== 'social-practice') throw new Error('Invalid story flow');
        const expected = r.storyOffer !== undefined && row.storySelection === undefined ? 'choose_story' : (r.index as number) <= si ? 'story' : (r.index as number) <= pi ? 'practice' : flow.version === 2 ? 'activities' : 'reflection';
        if (flow.stage !== expected) throw new Error('Invalid story flow stage');
      }
      if (r.supportPracticeCompleted !== undefined && typeof r.supportPracticeCompleted !== 'boolean') throw new Error('Invalid support practice state');
      if (Array.isArray(r.plan)) {
        const scenario = r.plan.find(p => object(p) && p.type === 'scenario');
        for (const p of r.plan) {
          if (object(p) && p.type === 'task' && p.taskId === 'support-practice' && p.practiceScenarioId !== undefined &&
              (!object(scenario) || p.practiceScenarioId !== scenario.scenarioId)) throw new Error('Invalid support practice association');
        }
      }

      if (Array.isArray(r.items) && !r.items.every(item => !object(item) || !object(item.instance) || item.instance.kind !== 'social-practice' || supportSnapshot(item.instance))) throw new Error('Invalid support practice content');
    }
    if (row.storySelection !== undefined && (!object(row.storySelection) || !text(row.storySelection.cardId))) throw new Error('Invalid story selection');
    if (object(row.runtime) && row.runtime.storyOffer !== undefined) {
      const r = row.runtime; const offer = r.storyOffer;
      if (!Array.isArray(offer) || offer.length < 2 || offer.length > 3 ||
          !offer.every(c => object(c) && text(c.id) && text(c.scenarioId) && text(c.title) && text(c.practiceTaskId)) ||
          new Set(offer.map(c => (c as Record<string, unknown>).id)).size !== offer.length) throw new Error('Invalid story offer');
      if (r.storyVersions !== undefined) {
        if (!object(r.storyVersions) || Object.keys(r.storyVersions).length !== offer.length || !offer.every(c => object(c) && storySnapshot((r.storyVersions as Record<string, unknown>)[c.id as string], c.scenarioId))) throw new Error('Invalid story versions');
      }
      if (r.supportVersions !== undefined && (!object(r.supportVersions) || Object.keys(r.supportVersions).length !== offer.length || !offer.every(c => object(c) && supportSnapshot((r.supportVersions as Record<string, unknown>)[c.id as string])))) throw new Error('Invalid support practice versions');
      if (row.storySelection === undefined && r.index !== 0) throw new Error('Unselected story session advanced');
      if (object(row.storySelection)) {
        const selected = offer.find(c => object(c) && c.id === (row.storySelection as Record<string, unknown>).cardId);
        const scenario = (r.plan as unknown[]).find(p => object(p) && p.type === 'scenario');
        const item = (r.items as unknown[]).find(p => object(p) && p.type === 'scenario');
        if (!object(selected) || !object(scenario) || !object(item) || selected.scenarioId !== scenario.scenarioId || selected.scenarioId !== item.scenarioId || !Array.isArray(row.plan) || !row.plan.includes(`scenario:${selected.scenarioId}`)) throw new Error('Story selection mismatch');
      }
    }
    if (object(row.runtime) && row.runtime.review !== undefined && (!object(row.runtime.review) || !text(row.runtime.review.topicId))) throw new Error('Invalid review session');
    if (row.lastReceipt !== undefined && (!object(row.lastReceipt) || !Number.isInteger(row.lastReceipt.step) || (row.lastReceipt.step as number) < 0 || !text(row.lastReceipt.fingerprint) || !object(row.lastReceipt.result))) throw new Error('Invalid session receipt');
  }
  if (key === 'playerStates') {
    if (row.family !== undefined && !validFamilyState(row.family)) throw new Error('Invalid family state');
    if (row.feelings !== undefined) {
      const feelings = row.feelings;
      if (!object(feelings) || !validPreferences(feelings.prefs) || !Array.isArray(feelings.items)) throw new Error('Invalid feelings state');
      // Отметки без согласия — ошибка данных, а не просто «пусто».
      if (!feelings.prefs.saveEnabled && feelings.items.length > 0) throw new Error('Feelings saved without consent');
      if (!feelings.items.every(validCheckIn)) throw new Error('Invalid feeling check-in');
      if (feelings.items.length > MAX_CHECKINS) throw new Error('Too many feeling check-ins');
      if (new Set(feelings.items.map((item: { id: string }) => item.id)).size !== feelings.items.length) throw new Error('Duplicate feeling check-in');
    }
    if (!arrayIfPresent(row.badges) || !arrayIfPresent(row.inventory) || (row.stats !== undefined && !object(row.stats)) || (row.equipped !== undefined && !object(row.equipped)) || (row.missions !== undefined && !object(row.missions))) throw new Error('Invalid player state');
    if (object(row.missions) && (!arrayIfPresent(row.missions.ids) || !arrayIfPresent(row.missions.claimed) || (row.missions.progress !== undefined && !object(row.missions.progress)))) throw new Error('Invalid player missions');
  }
  if (key === 'payments' && !['creating', 'pending', 'succeeded', 'canceled'].includes(String(row.status))) throw new Error('Invalid payment status');
  if (key === 'programStates' && row.reviewDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.reviewDay))) throw new Error('Invalid review day');
  if (key === 'programStates' && row.reviewStates !== undefined) {
    // Расписание повторения: только сроки и счётчики, без текстов и свободных полей.
    if (!Array.isArray(row.reviewStates)) throw new Error('Invalid review states');
    const seenTopics = new Set<string>();
    for (const state of row.reviewStates) {
      if (!object(state) || !text(state.topicId) || !['5-7', '8-10', '11-13'].includes(String(state.band))
        || !Number.isInteger(state.reviews) || (state.reviews as number) < 0 || (state.reviews as number) > 4
        || !Number.isInteger(state.skipped) || (state.skipped as number) < 0
        || !(state.dueAt === null || (typeof state.dueAt === 'number' && Number.isFinite(state.dueAt) && state.dueAt >= 0))
        || !Number.isFinite(state.updatedAt)) throw new Error('Invalid review state');
      if (Object.keys(state).some(key => !['topicId', 'band', 'reviews', 'dueAt', 'skipped', 'updatedAt'].includes(key))) throw new Error('Invalid review state fields');
      if (seenTopics.has(String(state.topicId))) throw new Error('Duplicate review topic');
      seenTopics.add(String(state.topicId));
    }
  }
  if (key === 'events') {
    // Журнал хранит только разрешённые технические поля; свободный текст и отметки чувств здесь недопустимы.
    if (!text(row.profileId) || !text(row.ownerId) || !Number.isFinite(row.at) || !text(row.dedupeKey) || !object(row.event)) throw new Error('Invalid event record');
    const checked = validateEvent(row.event);
    if (!checked.ok) throw new Error(`Invalid event: ${checked.error}`);
    if (row.event.type === 'profile_deleted') throw new Error('Invalid event: deletion is not journalled');
  }
}
