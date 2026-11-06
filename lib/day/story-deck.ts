import { qbnAllowsCard } from './story-qbn.ts';
import { PROGRAM_DAYS, SCENARIO_BY_ID } from '../content/program/index.ts';
import { STORYLETS_BY_ID } from '../content/storylets.ts';
import type { AgeBand } from '../types.ts';

/** Server-owned metadata, not a client-supplied eligibility rule. */
export type StoryCard = {
  id: string;
  dayIndex: number;
  bands: readonly AgeBand[];
  scenarioId: string;
  requires?: readonly string[];
  repeatable?: boolean;
};
export type StoryChoice = { id: string; scenarioId: string; title: string; practiceTaskId: string };
const ALL_STORY_SCENARIOS = { ...SCENARIO_BY_ID, ...STORYLETS_BY_ID };
export const DAY_STORY_CARDS: readonly StoryCard[] = [
  { id: 'day_1_music', dayIndex: 0, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d1_music', repeatable: true },
  { id: 'day_2_postcard', dayIndex: 1, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d2_postcard', repeatable: true },
  { id: 'day_3_garden', dayIndex: 2, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d3_garden', repeatable: true },
  { id: 'day_4_bridge', dayIndex: 3, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d4_bridge', repeatable: true },
  { id: 'day_5_puppet', dayIndex: 4, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d5_puppet', repeatable: true },
  { id: 'day_6_club', dayIndex: 5, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w2d1_club', repeatable: true },
  { id: 'day_7_library', dayIndex: 6, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w2d2_library', repeatable: true },
  { id: 'day_8_pencil', dayIndex: 7, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w2d3_pencil', repeatable: true },
  { id: 'day_9_station', dayIndex: 8, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w2d4_station', repeatable: true },
  { id: 'day_10_cards', dayIndex: 9, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w2d5_cards', repeatable: true },
  { id: 'day_11_seedling', dayIndex: 10, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w3d1_seedling', repeatable: true },
  { id: 'day_12_map', dayIndex: 11, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w3d2_map', repeatable: true },
  { id: 'day_13_kite', dayIndex: 12, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w3d3_kite', repeatable: true },
  { id: 'day_14_workshop', dayIndex: 13, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w3d4_workshop', repeatable: true },
  { id: 'day_15_team', dayIndex: 14, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w3d5_team', repeatable: true },
  { id: 'day_16_assembly', dayIndex: 15, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w4d1_assembly', repeatable: true },
  { id: 'day_17_banner', dayIndex: 16, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w4d2_banner', repeatable: true },
  { id: 'day_18_book', dayIndex: 17, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w4d3_book', repeatable: true },
  { id: 'day_19_route', dayIndex: 18, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w4d4_route', repeatable: true },
  { id: 'day_20_spill', dayIndex: 19, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w4d5_spill', repeatable: true },
  { id: 'day_21_crafts', dayIndex: 20, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w5d1_crafts', repeatable: true },
  { id: 'day_22_materials', dayIndex: 21, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w5d2_materials', repeatable: true },
  { id: 'day_23_scarf', dayIndex: 22, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w5d3_scarf', repeatable: true },
  { id: 'day_24_festival', dayIndex: 23, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w5d4_festival', repeatable: true },
  { id: 'day_25_choice', dayIndex: 24, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w5d5_choice', repeatable: true },
  { id: 'day_26_map', dayIndex: 25, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w6d1_map', repeatable: true },
  { id: 'day_27_tempo', dayIndex: 26, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w6d2_tempo', repeatable: true },
  { id: 'day_28_pause', dayIndex: 27, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w6d3_pause', repeatable: true },
  { id: 'day_29_example', dayIndex: 28, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w6d4_example', repeatable: true },
  { id: 'day_30_design', dayIndex: 29, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w6d5_design', repeatable: true },
  { id: 'day_31_space', dayIndex: 30, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w7d1_space', repeatable: true },
  { id: 'day_32_remember', dayIndex: 31, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w7d2_remember', repeatable: true },
  // Переключение внимания — саморегуляция, поэтому сцена стоит рядом с
  // основной историей того же дня, а не в дне про отношения.
  { id: 'day_33_switch', dayIndex: 32, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w7d3_switch', repeatable: true },
  { id: 'day_34_note', dayIndex: 33, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w7d4_note', repeatable: true },
  { id: 'day_35_check', dayIndex: 34, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w7d5_check', repeatable: true },
  { id: 'day_36_supplies', dayIndex: 35, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w8d1_supplies', repeatable: true },
  // Карта-схема и рассказ о работе — творческие сцены, а не решения. Стоят в
  // день творчества: карточка дня обязана совпадать по компетенции с днём.
  { id: 'day_37_path', dayIndex: 36, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w8d2_path', repeatable: true },
  { id: 'day_38_step', dayIndex: 37, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w8d3_step', repeatable: true },
  { id: 'day_39_tell', dayIndex: 38, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w8d4_tell', repeatable: true },
  { id: 'day_40_gallery', dayIndex: 39, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w8d5_gallery', repeatable: true },
  { id: 'day_41_rules', dayIndex: 40, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w9d1_rules', repeatable: true },
  { id: 'day_42_weather', dayIndex: 41, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w9d2_weather', repeatable: true },
  { id: 'day_43_roles', dayIndex: 42, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w9d3_roles', repeatable: true },
  { id: 'day_44_signal', dayIndex: 43, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w9d4_signal', repeatable: true },
  { id: 'day_45_plan', dayIndex: 44, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w9d5_plan', repeatable: true },
  { id: 'day_46_prepare', dayIndex: 45, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w10d1_prepare', repeatable: true },
  { id: 'day_47_garden', dayIndex: 46, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w10d2_garden', repeatable: true },
  { id: 'day_48_order', dayIndex: 47, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w10d3_order', repeatable: true },
  { id: 'day_49_change', dayIndex: 48, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w10d4_change', repeatable: true },
  { id: 'day_50_review', dayIndex: 49, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w10d5_review', repeatable: true },
  { id: 'day_51_cloud', dayIndex: 50, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w11d1_cloud', repeatable: true },
  { id: 'day_52_game', dayIndex: 51, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w11d2_game', repeatable: true },
  { id: 'day_53_show', dayIndex: 52, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w11d3_show', repeatable: true },
  { id: 'day_54_shadow', dayIndex: 53, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w11d4_shadow', repeatable: true },
  { id: 'day_55_shapes', dayIndex: 54, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w11d5_shapes', repeatable: true },
  { id: 'day_56_invite', dayIndex: 55, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w12d1_invite', repeatable: true },
  { id: 'day_57_comment', dayIndex: 56, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w12d2_comment', repeatable: true },
  { id: 'day_58_new', dayIndex: 57, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w12d3_new', repeatable: true },
  { id: 'day_59_offer', dayIndex: 58, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w12d4_offer', repeatable: true },
  { id: 'day_60_finish', dayIndex: 59, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w12d5_finish', repeatable: true },
  { id: 'day_1_picture', dayIndex: 0, bands: ['5-7', '8-10', '11-13'], scenarioId: 'w1d1_picture', repeatable: true },
  // Истории под навыки, у которых не было ни одной сцены. Ставятся на дни
  // своей компетенции, чтобы ребёнок действительно до них дошёл: история без
  // карточки в дне остаётся на складе.
  // Эти две сцены стоят на первом дне намеренно. Если положить их третьими в
  // день, где уже есть основная история и дополнительная, ребёнок за один
  // проход программы до них не дойдёт: в выдаче дня максимум три карточки, а
  // значит доступны только две верхние. Здесь они лежат рядом с двумя другими
  // самопознавательными сценами, и все три достижимы.
  { id: 'day_2_name_feelings', dayIndex: 1, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_name_feelings', repeatable: true },
  { id: 'day_3_strengths', dayIndex: 2, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_recognize_strengths', repeatable: true },
  { id: 'day_8_hold_impulse', dayIndex: 7, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_hold_impulse', repeatable: true },
  { id: 'day_13_comfort_other', dayIndex: 12, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_comfort_other', repeatable: true },
  // Вторые сцены навыков, у которых была одна история: те же умения в другой
  // ситуации. Ставятся на дни своей компетенции рядом с основным выбором.
  { id: 'day_5_name_feelings', dayIndex: 4, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_name_feelings', repeatable: true },
  { id: 'day_8_strengths_2', dayIndex: 8, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_recognize_strengths', repeatable: true },
  { id: 'day_6_wait_turn', dayIndex: 6, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_wait_turn', repeatable: true },
  { id: 'day_9_hold_impulse_2', dayIndex: 9, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_hold_impulse', repeatable: true },
  { id: 'day_11_not_judge_2', dayIndex: 11, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_not_judge', repeatable: true },
  { id: 'day_52_combine_ideas_2', dayIndex: 52, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk2_combine_ideas', repeatable: true },
  { id: 'day_15_not_judge', dayIndex: 14, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_not_judge', repeatable: true },
  { id: 'day_52_combine_ideas', dayIndex: 51, bands: ['5-7', '8-10', '11-13'], scenarioId: 'sk_combine_ideas', repeatable: true },
];
const bands: readonly AgeBand[] = ['5-7', '8-10', '11-13'];
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;

/** Deterministic ordering, not randomness for authentication or security. */
function rank(seed: string, id: string): number {
  let hash = 2166136261;
  for (const ch of `${seed}\0${id}`) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/**
 * A versioned offer should be saved with the session, never redrawn on resume.
 * Catalog entries are explicitly supplied by the caller; fallback always uses the
 * existing age-specific scenario for the day.
 */
export function selectStoryCards(dayIndex: number, band: AgeBand, seen: readonly string[], seed: string, extra: readonly StoryCard[] = []): StoryChoice[] {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= PROGRAM_DAYS.length || !bands.includes(band) || typeof seed !== 'string' || !seed || seed.length > 128 || !Array.isArray(seen) || seen.some(id => typeof id !== 'string' || !idPattern.test(id))) throw Error('invalid_deck_request');
  const day = PROGRAM_DAYS[dayIndex];
  const fallback: StoryCard = { id: `day_${dayIndex + 1}_default`, dayIndex, bands, scenarioId: day.day.scenarioId, repeatable: true };
  const ids = new Set(PROGRAM_DAYS.map(d => `day_${d.index + 1}_default`));
  const stories = new Set(PROGRAM_DAYS.map(d => `${d.index}:${d.day.scenarioId}`));
  for (const c of extra) {
    if (!c || typeof c.id !== 'string' || !idPattern.test(c.id) || ids.has(c.id) || !Number.isInteger(c.dayIndex) || c.dayIndex < 0 || c.dayIndex >= PROGRAM_DAYS.length || !Array.isArray(c.bands) || !c.bands.length || c.bands.some(b => !bands.includes(b)) || new Set(c.bands).size !== c.bands.length || typeof c.scenarioId !== 'string' || !Object.hasOwn(ALL_STORY_SCENARIOS, c.scenarioId) || (c.requires !== undefined && (!Array.isArray(c.requires) || c.requires.some(id => typeof id !== 'string' || !idPattern.test(id)))) || (c.repeatable !== undefined && typeof c.repeatable !== 'boolean')) throw Error('invalid_story_catalog');
    const storyKey = `${c.dayIndex}:${c.scenarioId}`;
    if (stories.has(storyKey)) throw Error('duplicate_day_story');
    stories.add(storyKey);
    // Компетенция карточки может отличаться от компетенции дня, и это нормально.
    //
    // Ребёнок выбирает одну историю из двух, а не проходит обе: тема дня — та,
    // которую он выбрал. Жёсткое требование совпадения заставляло либо метить
    // историю чужой компетенцией, либо оставлять день без второй карточки.
    // Когнитивные недели (7–10) как раз такие: «Память» и «Гибкость» содержат
    // сцены про решения, и обе метки верны для своих историй.
    ids.add(c.id);
  }
  const seenSet = new Set(seen);
  return [fallback, ...extra].filter(c => c.dayIndex === dayIndex && c.bands.includes(band) && (c.repeatable || !seenSet.has(c.id)) && (c.requires ?? []).every(id => seenSet.has(id)) && qbnAllowsCard(c, dayIndex, band, seenSet))
    .sort((a, b) => rank(seed, a.id) - rank(seed, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 3)
    .map(c => {
      const scenario = ALL_STORY_SCENARIOS[c.scenarioId];
      return { id: c.id, scenarioId: c.scenarioId, title: scenario.variants[band].title, practiceTaskId: scenario.practiceTaskId };
    });
}
