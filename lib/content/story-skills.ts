import type { CompetencyId } from '../types';
import { PROGRAM_SCENARIOS } from './program/index';
import { STORYLETS_BY_ID } from './storylets';

/**
 * Карта «история → навыки»: какие конкретные умения тренирует каждая история.
 *
 * Зачем вручную, а не по ключевым словам. Автоматическая разметка по словам
 * даёт ложные срабатывания: «замолчал» попадает под «молчи», а история про
 * поделку выглядит как история про внимание. Здесь каждая связь прочитана по
 * тексту вопроса и вариантов — история относится к навыку, если ребёнок
 * действительно тренирует его, выбирая ответ.
 *
 * Одна история может тренировать несколько навыков: «предложить помощь» и
 * «уважать отказ» часто живут в одной сцене.
 *
 * Второе назначение карты — держать компетенцию истории честной. Навык
 * всегда принадлежит ровно одной компетенции, поэтому по навыкам видно,
 * совпадает ли метка истории с содержанием. Это проверяет
 * `test:competency-alignment`, а не человек глазами.
 */

export type StorySkillMap = {
  /** Навыки, которые история действительно тренирует. */
  skills: string[];
};

export const STORY_SKILLS: Record<string, StorySkillMap> = {
  /* ================= Самопознание ================= */
  // История про поддержку молчащего друга: тренируется чтение сигналов,
  // хотя размечена как «замечаем чувства».
  w1d1: { skills: ['read_signals', 'not_assume', 'comfort_other'] },
  w1d2: { skills: ['notice_feelings', 'know_preferences'] },
  w1d3: { skills: ['notice_feelings', 'notice_body_signals', 'take_break'] },
  w1d5: { skills: ['know_preferences', 'personal_boundaries'] },
  // Дни 8 — стратегии памяти (списки, подсказки, сверка), а не самопознание.
  w8d1: { skills: ['plan_steps', 'gather_info'] },
  w8d2: { skills: ['plan_steps', 'many_ideas'] },
  w8d3: { skills: ['gather_info', 'ask_help'] },
  w8d4: { skills: ['show_idea', 'return_to_task'] },
  w8d5: { skills: ['return_to_task', 'gather_info'] },
  w1d1_music: { skills: ['read_signals', 'not_assume', 'ask_how_are_you'] },
  w1d1_picture: { skills: ['offer_help', 'respect_emotions', 'comfort_other'] },
  w1d2_postcard: { skills: ['personal_boundaries', 'know_preferences'] },
  w1d3_garden: { skills: ['notice_feelings', 'take_break', 'notice_body_signals'] },
  w1d5_puppet: { skills: ['personal_boundaries', 'say_no'] },
  w8d1_supplies: { skills: ['plan_steps', 'gather_info'] },
  w8d2_path: { skills: ['many_ideas', 'show_idea'] },
  w8d3_step: { skills: ['ask_help', 'gather_info'] },
  w8d4_tell: { skills: ['show_idea'] },
  w8d5_gallery: { skills: ['return_to_task', 'gather_info'] },

  /* ================= Саморегуляция ================= */
  w2d1: { skills: ['gather_info', 'pause_before_answer'] },
  w2d2: { skills: ['take_break', 'calm_down'] },
  w2d3: { skills: ['personal_boundaries', 'say_no'] },
  w2d4: { skills: ['take_break', 'calm_down'] },
  w2d5: { skills: ['many_ideas', 'take_break'] },
  // Дни 7 — приёмы памяти и внимания: частично саморегуляция, частично планирование.
  w7d1: { skills: ['calm_down', 'switch_attention'] },
  w7d2: { skills: ['return_to_task', 'gather_info'] },
  w7d3: { skills: ['agree_rules', 'wait_turn'] },
  w7d4: { skills: ['return_to_task', 'plan_steps'] },
  w7d5: { skills: ['return_to_task'] },
  w12d2: { skills: ['respect_emotions', 'say_no', 'manage_frustration'] },
  w2d1_club: { skills: ['gather_info', 'pause_before_answer'] },
  w2d2_library: { skills: ['take_break', 'calm_down'] },
  w2d3_pencil: { skills: ['personal_boundaries', 'say_no'] },
  w2d4_station: { skills: ['take_break', 'calm_down'] },
  w2d5_cards: { skills: ['many_ideas', 'take_break'] },
  w7d1_space: { skills: ['calm_down', 'switch_attention'] },
  w7d2_remember: { skills: ['return_to_task'] },
  w7d3_switch: { skills: ['switch_attention'] },
  w7d4_note: { skills: ['return_to_task', 'plan_steps'] },
  w7d5_check: { skills: ['return_to_task'] },
  w12d2_comment: { skills: ['respect_emotions', 'say_no', 'manage_frustration'] },

  /* ================= Эмпатия ================= */
  w3d1: { skills: ['read_signals', 'offer_help'] },
  w3d2: { skills: ['gather_info', 'ask_how_are_you'] },
  w3d3: { skills: ['respect_emotions', 'accept_refusal'] },
  w3d4: { skills: ['not_assume'] },
  w3d5: { skills: ['know_preferences', 'see_options'] },
  w12d4: { skills: ['notice_distress', 'offer_help'] },
  w3d1_seedling: { skills: ['read_signals', 'offer_help'] },
  w3d2_map: { skills: ['gather_info', 'ask_how_are_you'] },
  w3d3_kite: { skills: ['accept_refusal', 'respect_emotions'] },
  w3d4_workshop: { skills: ['not_assume'] },
  w3d5_team: { skills: ['know_preferences', 'see_options'] },
  w12d4_offer: { skills: ['notice_distress', 'offer_help'] },

  /* ================= Отношения ================= */
  w4d1: { skills: ['ask_help'] },
  w4d2: { skills: ['apologize', 'handle_conflict'] },
  w4d3: { skills: ['say_no'] },
  w4d4: { skills: ['agree_rules'] },
  w4d5: { skills: ['apologize'] },
  w9d1: { skills: ['agree_rules', 'change_plan'] },
  w9d2: { skills: ['change_plan'] },
  w9d3: { skills: ['know_preferences', 'say_no'] },
  w9d4: { skills: ['try_another_way', 'change_plan'] },
  w9d5: { skills: ['agree_rules', 'gather_info'] },
  w12d1: { skills: ['join_group', 'offer_help'] },
  w4d1_assembly: { skills: ['ask_help'] },
  w4d2_banner: { skills: ['apologize', 'see_consequences'] },
  w4d3_book: { skills: ['say_no', 'personal_boundaries'] },
  w4d4_route: { skills: ['agree_rules', 'gather_info'] },
  w4d5_spill: { skills: ['apologize', 'offer_help'] },
  w9d1_rules: { skills: ['agree_rules', 'see_consequences'] },
  w9d2_weather: { skills: ['agree_rules', 'change_plan'] },
  w9d3_roles: { skills: ['know_preferences', 'say_no'] },
  w9d4_signal: { skills: ['agree_rules', 'gather_info'] },
  w9d5_plan: { skills: ['change_plan', 'agree_rules'] },
  w12d1_invite: { skills: ['gather_info', 'join_group'] },

  /* ================= Принятие решений ================= */
  w5d1: { skills: ['see_options'] },
  w5d2: { skills: ['plan_steps'] },
  w5d3: { skills: ['safe_choice', 'find_owner'] },
  w5d4: { skills: ['handle_conflict'] },
  w5d5: { skills: ['choose_and_own'] },
  w10d1: { skills: ['plan_steps'] },
  w10d2: { skills: ['plan_steps'] },
  w10d3: { skills: ['plan_steps'] },
  w10d4: { skills: ['plan_steps'] },
  w10d5: { skills: ['plan_steps', 'see_consequences'] },
  w5d1_crafts: { skills: ['see_options', 'choose_and_own'] },
  w5d2_materials: { skills: ['plan_steps', 'gather_info'] },
  w5d3_scarf: { skills: ['safe_choice', 'find_owner'] },
  w5d4_festival: { skills: ['handle_conflict', 'many_ideas'] },
  w5d5_choice: { skills: ['choose_and_own'] },
  w10d1_prepare: { skills: ['plan_steps'] },
  w10d2_garden: { skills: ['plan_steps'] },
  w10d3_order: { skills: ['plan_steps', 'see_consequences'] },
  w10d4_change: { skills: ['change_plan'] },
  w10d5_review: { skills: ['change_plan', 'see_consequences'] },

  /* ================= Творческое мышление ================= */
  w11d1: { skills: ['many_ideas', 'try_another_way'] },
  w11d2: { skills: ['many_ideas', 'agree_rules'] },
  w11d3: { skills: ['unusual_idea', 'show_idea'] },
  w11d4: { skills: ['improve_idea'] },
  w11d5: { skills: ['many_ideas'] },
  w11d1_cloud: { skills: ['many_ideas', 'unusual_idea'] },
  w11d2_game: { skills: ['many_ideas', 'show_idea'] },
  w11d3_show: { skills: ['show_idea'] },
  w11d4_shadow: { skills: ['unusual_idea', 'improve_idea'] },
  w11d5_shapes: { skills: ['many_ideas'] },

  /* ================= Мышление роста ================= */
  w1d4: { skills: ['notice_mistakes', 'try_another_way', 'learn_from_mistake'] },
  w6d1: { skills: ['learn_from_mistake', 'notice_mistakes'] },
  w6d2: { skills: ['celebrate_progress', 'keep_going'] },
  w6d3: { skills: ['try_another_way', 'keep_going', 'manage_frustration'] },
  w6d4: { skills: ['ask_for_guidance'] },
  w6d5: { skills: ['try_another_way'] },
  w12d3: { skills: ['try_another_way', 'know_preferences'] },
  w12d5: { skills: ['celebrate_progress'] },
  w1d4_bridge: { skills: ['notice_mistakes', 'try_another_way', 'keep_going'] },
  w6d1_map: { skills: ['notice_mistakes', 'learn_from_mistake', 'improve_idea'] },
  w6d2_tempo: { skills: ['celebrate_progress'] },
  w6d3_pause: { skills: ['ask_for_guidance', 'try_another_way'] },
  w6d4_example: { skills: ['ask_for_guidance'] },
  w6d5_design: { skills: ['try_another_way'] },
  w12d3_new: { skills: ['try_another_way'] },
  w12d5_finish: { skills: ['celebrate_progress'] },

  /* ===== Истории, добавленные под непокрытые навыки ===== */
  // Шесть навыков не имели ни одной сцены; истории написаны прямо под них,
  // поэтому связь здесь один-к-одному (см. lib/content/skill-gap-stories.ts).
  sk_name_feelings: { skills: ['name_feelings'] },
  sk_recognize_strengths: { skills: ['recognize_strengths'] },
  sk_hold_impulse: { skills: ['hold_impulse'] },
  sk_comfort_other: { skills: ['comfort_other'] },
  sk_not_judge: { skills: ['not_judge'] },
  sk_combine_ideas: { skills: ['combine_ideas'] },
  // Вторые сцены тех же шести навыков: другая ситуация, то же умение.
  sk2_name_feelings: { skills: ['name_feelings'] },
  sk2_recognize_strengths: { skills: ['recognize_strengths'] },
  sk2_wait_turn: { skills: ['wait_turn'] },
  sk2_hold_impulse: { skills: ['hold_impulse'] },
  sk2_not_judge: { skills: ['not_judge'] },
  sk2_combine_ideas: { skills: ['combine_ideas'] },
};

/** Все навыки, которые встречаются хотя бы в одной истории. */
export function coveredSkillIds(): Set<string> {
  const covered = new Set<string>();
  for (const entry of Object.values(STORY_SKILLS)) for (const id of entry.skills) covered.add(id);
  return covered;
}

/** Истории, тренирующие навык. */
export function storiesForSkill(skillId: string): string[] {
  return Object.entries(STORY_SKILLS)
    .filter(([, entry]) => entry.skills.includes(skillId))
    .map(([storyId]) => storyId);
}


