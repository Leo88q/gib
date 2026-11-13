import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { YEAR } from '@/lib/content/year/index.ts';
import { yearProgress } from '@/lib/content/year/types.ts';
import { alignYear } from '@/lib/year/fgos.ts';
import { lessonPage } from '@/lib/year/valued.ts';
import {
  attendanceSummary,
  buildSchedule,
  lessonToShow,
  markAttendance,
  type ScheduledLesson,
} from '@/lib/year/lessons.ts';

export const dynamic = 'force-dynamic';

/**
 * Расписание занятий года: 36 дат и отметки «был / не был».
 *
 * Зачем маршрут. Годовая программа — это занятие раз в неделю, а не «день 34 из
 * 60». Родителю нужно знать, когда следующая встреча, а исследованию — дозу:
 * сколько занятий ребёнок действительно посетил. Без отметок нельзя ни отделить
 * эффект программы от посещаемости, ни увидеть выбывание.
 *
 * Что маршрут делает и чего не делает:
 *  - GET отдаёт расписание, сводку и следующее занятие;
 *  - POST ставит отметку «был / не был» на одно занятие;
 *  - маршрут **не** принимает причину отсутствия и не принимает оценок. Причина
 *    — чувствительное поле, её сбор требует отдельного согласия и решения.
 *    Отказ на уровне маршрута, а не только валидатора: иначе поле появится в
 *    хранилище раньше, чем будет решение.
 *
 * Кто отмечает. Взрослый владелец аккаунта — тот же, кто входит в кабинет.
 * Отметка — факт посещения, а не оценка ребёнка, поэтому она не влияет на
 * прогресс симулятора и не показывается ребёнку как «ты пропустил».
 */

const MAX_LESSONS = 60;

function scheduleOf(profileId: string, startedAt: number): ScheduledLesson[] {
  const state = store.programState(profileId);
  if (state.lessons?.length) return state.lessons;

  // Расписание создаётся один раз — по дате старта программы. Дальше оно живёт
  // в состоянии: дата старта не должна пересчитывать прошедшие занятия, если
  // взрослый открыл кабинет позже.
  const startIso = new Date(startedAt).toISOString().slice(0, 10);
  const schedule = buildSchedule(YEAR, startIso);
  store.setProgramState({ ...state, lessons: schedule });
  return schedule;
}

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'lessons', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });

  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

    const state = store.programState(profile.id);
    const schedule = scheduleOf(profile.id, state.startedAt);
    const today = new Date().toISOString().slice(0, 10);

    return NextResponse.json({
      lessons: schedule.map((entry) => ({
        lesson: entry.lesson,
        date: entry.date,
        attended: entry.attended ?? null,
        // Тему и навыки берём из сетки, чтобы родитель видел «тема 6», а не
        // только номер занятия.
        unit: YEAR.lessons.find((lesson) => lesson.number === entry.lesson)?.unit ?? null,
        title: YEAR.lessons.find((lesson) => lesson.number === entry.lesson)?.title ?? '',
        isShowcase: YEAR.lessons.find((lesson) => lesson.number === entry.lesson)?.isShowcase ?? false,
      })),
      attendance: attendanceSummary(schedule, today),
      /**
       * Какое занятие считать следующим. Не «где календарь», а «к чему ребёнок
       * готов»: если он прошёл дни вперёд, показываем занятие по факту и
       * говорим об этом прямо (`reason: 'ahead'`). Иначе семья видит 11-е
       * занятие, хотя симулятор уже на 14-м, и решает, что прогресс потерялся.
       */
      next: (() => {
        const completed = Array.from({ length: Math.max(0, state.completedDays) }, (_, i) => i);
        const shown = lessonToShow({ year: YEAR, schedule, completedDayIndexes: completed, today });
        if (!shown) return null;
        const entry = schedule.find((item) => item.lesson === shown.lesson);
        // `lesson` — ближайшая встреча по расписанию, `readyFor` — занятие, к
        // которому ребёнок готов. Это два разных числа, и родителю нужны оба.
        return { ...shown, attended: entry?.attended ?? null };
      })(),
      progress: yearProgress(YEAR, Array.from({ length: Math.max(0, state.completedDays) }, (_, i) => i)),
      /**
       * Страница занятия для родителя: что тренировали и как это видно в жизни.
       *
       * Отдаётся на ближайшее занятие, а не на все 36: родителю нужен один
       * экран перед четвергом, а не таблица за год. Полная таблица есть у
       * педагога — ему она нужна для школы.
       */
      page: (() => {
        const nextNumber = (() => {
          const completed = Array.from({ length: Math.max(0, state.completedDays) }, (_, i) => i);
          return lessonToShow({ year: YEAR, schedule, completedDayIndexes: completed, today });
        })();
        if (!nextNumber) return null;
        const lesson = YEAR.lessons.find((item) => item.number === nextNumber.readyFor);
        if (!lesson) return null;
        const alignment = alignYear(YEAR).find((item) => item.lesson === lesson.number);
        const page = lessonPage(lesson, alignment?.wording ?? '');
        // Результат ФГОС родителю не показывается: он написан для школы и в
        // отчёте родителю читался бы как оценка. Отдаём без него.
        return {
          lesson: page.lesson,
          trained: page.trained,
          // Истории занятия: без них страница одна и та же три недели подряд.
          scenes: page.scenes.slice(0, 2),
          examples: page.examples,
          noticeAtHome: page.noticeAtHome,
        };
      })(),
      total: YEAR.total,
    });
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'lessons-mark', auth.parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { profileId, lesson, attended, reason, ...rest } = body as Record<string, unknown>;

  if (typeof profileId !== 'string' || !profileId) {
    return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  }
  if (typeof lesson !== 'number' || !Number.isInteger(lesson) || lesson < 1 || lesson > MAX_LESSONS) {
    return NextResponse.json({ error: 'invalid_lesson' }, { status: 400 });
  }
  if (typeof attended !== 'boolean') {
    return NextResponse.json({ error: 'invalid_attended' }, { status: 400 });
  }

  // Причина отсутствия и любые «комментарии» отвергаются явной ошибкой, а не
  // молча отбрасываются: молчаливый отброс оставляет уверенность, что данные
  // сохранились.
  if (reason !== undefined) return NextResponse.json({ error: 'reason_not_collected' }, { status: 400 });
  if (Object.keys(rest).length > 0) return NextResponse.json({ error: 'unexpected_fields' }, { status: 400 });

  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

    const state = store.programState(profile.id);
    const schedule = scheduleOf(profile.id, state.startedAt);

    let updated: ScheduledLesson[];
    try {
      updated = markAttendance(schedule, lesson, attended);
    } catch {
      return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
    }

    store.setProgramState({ ...state, lessons: updated });

    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      lesson,
      attended,
      attendance: attendanceSummary(updated, today),
    });
  });
}
