import { YEAR } from '../content/year/index.ts';
import type { LessonReminderState } from '../types.ts';
import type { ScheduledLesson } from '../year/lessons.ts';

export const DEFAULT_LESSON_REMINDER: LessonReminderState = {
  enabled: false,
  lastRemindedLesson: null,
  lastRemindedAt: null,
};

/** Окно напоминания: от текущего момента до 36 часов до начала даты встречи. */
export const LESSON_REMINDER_WINDOW_MS = 36 * 60 * 60 * 1000;

export type DueLessonReminder = {
  lesson: number;
  date: string;
  title: string;
  isShowcase: boolean;
};

/**
 * Определяет, нужно ли сейчас отправить взрослому напоминание о предстоящем
 * очном занятии ребёнка. Отправляется не чаще одного раза на номер встречи.
 */
export function findDueLessonReminder(
  reminder: LessonReminderState | undefined,
  lessons: readonly ScheduledLesson[] | undefined,
  now = Date.now(),
): DueLessonReminder | null {
  if (!reminder?.enabled || !lessons || lessons.length === 0) return null;

  for (const item of lessons) {
    if (item.attended !== undefined) continue;
    // Считаем утренний старт дня встречи (09:00 UTC) ориентиром суточного окна.
    const targetMs = Date.parse(`${item.date}T09:00:00.000Z`);
    if (!Number.isFinite(targetMs)) continue;
    const diff = targetMs - now;
    if (diff > -3 * 60 * 60 * 1000 && diff <= LESSON_REMINDER_WINDOW_MS) {
      if (reminder.lastRemindedLesson === item.lesson) return null;
      const meta = YEAR.lessons.find((l) => l.number === item.lesson);
      return {
        lesson: item.lesson,
        date: item.date,
        title: meta?.title ?? `Встреча ${item.lesson}`,
        isShowcase: Boolean(meta?.isShowcase),
      };
    }
  }
  return null;
}

export function formatLessonReminderMessage(params: {
  childName: string;
  due: DueLessonReminder;
  groupName?: string | null;
}): string {
  const { childName, due, groupName } = params;
  const header = groupName
    ? `Напоминание о встрече кружка «${groupName}» (${childName})`
    : `Напоминание о предстоящей встрече (${childName})`;
  const showcaseNote = due.isShowcase
    ? 'Это встреча-показ: ребёнок выходит на площадку только по приглашению и сохраняет право сказать «пропускаю» без оценок.'
    : 'Занятие длится 40 минут в спокойном темпе без оценок и сравнения детей.';
  return [
    header,
    `Дата: ${due.date} · Встреча ${due.lesson}: «${due.title}».`,
    showcaseNote,
  ].join('\n\n');
}
