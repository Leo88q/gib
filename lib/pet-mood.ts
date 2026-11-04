/**
 * Настроение питомца — художественная реакция на игровые действия, а не вывод
 * о ребёнке.
 *
 * Правила намеренно щедрые и «мягкие»:
 * - хорошее настроение зависит от недавней игры, а не от успехов или серии;
 * - пропуск и долгий перерыв не делают питомца грустным и никогда не «убивают»
 *   его: после паузы он просто соскучился и ждёт;
 * - ничего из этого не сохраняется — настроение считается из уже имеющегося
 *   прогресса и не создаёт новых данных о ребёнке.
 */

export type PetMood = 'happy' | 'sleepy' | 'curious' | 'missing';

export type PetMoodInput = {
  /** Сколько всего занятий завершено — только факт участия. */
  completedDays: number;
  /** Сколько дней прошло с последнего завершённого занятия (null — занятий не было). */
  daysSinceLast: number | null;
};

/**
 * Порог «давно не играли» — неделя. Выбран так, чтобы обычные перерывы
 * (болезнь, поездка, каникулы) не вызывали грусти.
 */
export const MISSING_AFTER_DAYS = 7;

export function petMood({ completedDays, daysSinceLast }: PetMoodInput): PetMood {
  if (!Number.isFinite(completedDays) || completedDays <= 0 || daysSinceLast === null) return 'curious';
  // Испорченное значение (NaN, отрицательное) считаем спокойным сном: лучше
  // показать дремлющего питомца, чем радость или грусть из-за ошибки данных.
  if (!Number.isFinite(daysSinceLast) || daysSinceLast < 0) return 'sleepy';
  if (daysSinceLast === 0) return 'happy';
  if (daysSinceLast < MISSING_AFTER_DAYS) return 'sleepy';
  return 'missing';
}

/**
 * Подпись рядом с питомцем. Только про питомца и его состояние, без оценок
 * ребёнка, без вины и без обещаний награды.
 */
export function petMoodText(mood: PetMood): string {
  switch (mood) {
    case 'happy':
      return 'Мур радуется, что ты зашёл.';
    case 'sleepy':
      return 'Мур дремлет рядом. Можно просто посидеть.';
    case 'missing':
      return 'Мур соскучился и ждёт, когда захочется вернуться.';
    default:
      return 'Мур разглядывает район и готов к приключению.';
  }
}

/**
 * Стадия роста питомца — по уровню, как и раньше, но вынесена сюда, чтобы
 * правила были проверяемы отдельно от SVG.
 */
export function petStage(level: number): 0 | 1 | 2 {
  if (!Number.isFinite(level) || level < 3) return 0;
  if (level < 6) return 1;
  return 2;
}
