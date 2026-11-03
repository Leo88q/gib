import type { AgeBand, SkillId, SkillState } from '../types';

export const SKILL_LABELS: Record<SkillId, string> = {
  attention: 'Внимание',
  working_memory: 'Рабочая память',
  flexibility: 'Гибкость',
  inhibition: 'Торможение',
  planning: 'Планирование',
  logic: 'Логика',
};

export const SKILL_ORDER: SkillId[] = [
  'attention',
  'working_memory',
  'flexibility',
  'inhibition',
  'planning',
  'logic',
];

const LEVEL_RANGE: Record<SkillId, [number, number]> = {
  attention: [1, 5],
  working_memory: [1, 6],
  flexibility: [1, 5],
  inhibition: [1, 5],
  planning: [1, 4],
  logic: [1, 5],
};

/** Возрастной потолок сложности: малышам не даём слишком «взрослые» задания. */
export function levelCap(band: AgeBand, skill: SkillId): number {
  const [min, max] = LEVEL_RANGE[skill];
  if (band === '5-7') return Math.min(max, min + 1);
  if (band === '8-10') return Math.min(max, min + 3);
  return max;
}

export function bandOf(age: number): AgeBand {
  if (age <= 7) return '5-7';
  if (age <= 10) return '8-10';
  return '11-13';
}

export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Лестница сложности: две верные подряд — шаг вверх, две неверные — шаг вниз.
 * Оценка способности (ability, 0..1) — экспоненциальное обновление с поправкой на скорость.
 */
export function advance(
  state: SkillState,
  correct: boolean,
  ms: number,
  targetMs: number,
  band: AgeBand
): { level: number; ability: number; streak: number } {
  const [min, max] = LEVEL_RANGE[state.skill];
  const cap = levelCap(band, state.skill);

  // «Лестница»: две верные подряд — шаг вверх, две неверные — шаг вниз.
  // Полоса (streak) хранится в профиле навыка, а не внутри функции.
  const streakBonus = clamp(1 - ms / Math.max(targetMs, 1), 0.2, 1.4);
  const streak = state.streak ?? 0;

  let level = state.level;
  let nextStreak: number;
  if (correct) {
    nextStreak = streak > 0 ? streak + 1 : 1;
    if (nextStreak >= 2) {
      level = level + 1;
      nextStreak = 0;
    }
  } else {
    nextStreak = streak < 0 ? streak - 1 : -1;
    if (nextStreak <= -2) {
      level = level - 1;
      nextStreak = 0;
    }
  }
  level = clamp(level, min, cap);

  const delta = (correct ? 0.07 : -0.09) * streakBonus;
  const ability = clamp(state.ability + delta, 0.02, 0.99);

  return { level, ability, streak: nextStreak };
}

export function initialSkill(skill: SkillId, band: AgeBand): SkillState {
  const [min] = LEVEL_RANGE[skill];
  return {
    skill,
    level: min,
    ability: 0.35,
    streak: 0,
    played: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Выбор навыков для тренировки: самые «слабые», но с ротацией по дням,
 * чтобы за неделю ребёнок прошёл все шесть навыков, а не одни и те же три.
 */
export function pickSkills(
  states: (SkillState & { profileId?: string })[],
  count = 3,
  dayIndex = 0
): SkillId[] {
  const offset = ((dayIndex % SKILL_ORDER.length) + SKILL_ORDER.length) % SKILL_ORDER.length;
  const rotated = [...SKILL_ORDER.slice(offset), ...SKILL_ORDER.slice(0, offset)];
  const rank = new Map(rotated.map((s, i) => [s, i]));
  const byAbility = [...SKILL_ORDER]
    .map((s) => states.find((x) => x.skill === s))
    .filter((x): x is SkillState & { profileId?: string } => Boolean(x))
    .sort(
      (a, b) =>
        a.ability - b.ability ||
        (rank.get(a.skill) ?? 0) - (rank.get(b.skill) ?? 0)
    );
  const picked = byAbility.slice(0, count).map((s) => s.skill);
  for (const s of SKILL_ORDER) {
    if (picked.length >= count) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked;
}
