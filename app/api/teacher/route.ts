import { NextResponse } from 'next/server';
import { requestParent } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { YEAR } from '@/lib/content/year/index.ts';
import { attendanceSummary, nextLesson } from '@/lib/year/lessons.ts';
import { groupStudents, teacherCanMark, type Membership, type Store as AccessStore } from '@/lib/teacher/access.ts';
import { newJoinCode, normalizeJoinCode } from '@/lib/teacher/invites.ts';
import { MEETING_MINUTES, meetingPlan } from '@/lib/year/meeting.ts';

export const dynamic = 'force-dynamic';

/**
 * Кабинет педагога: группа, отметки, родительский код.
 *
 * Зачем маршрут. Отметки, которые ставит родитель за своего ребёнка, дают
 * посещаемость у аккуратных родителей и не дают у остальных. Педагог ставит их
 * на всю группу за минуту — и данные появляются у всех.
 *
 * Роль педагога — это не второй вход, а возможность существующего аккаунта. Тот,
 * кто ведёт группу, пользуется тем же входом, что и взрослый: Telegram, MAX или
 * демо. Отдельного пароля для педагога нет, потому что второй способ входа —
 * это второе место, где можно ошибиться с правами.
 *
 * Что педагог видит: имя, возраст, посещено, пропущено, показы. Не видит
 * содержимое ответов, чувства, отчёт родителю. Список запретов объявлен в
 * lib/teacher/access.ts.
 *
 * Что делают методы:
 *  - GET  — группы педагога, дети в группе, ближайшее занятие;
 *  - POST action=mark      — отметка «был / не был» ребёнку своей группы;
 *  - POST action=join      — родитель вводит код группы и добавляет ребёнка;
 *  - POST action=leave     — родитель забирает ребёнка из группы.
 */

type Action = 'mark' | 'join' | 'leave';

const MAX_LESSONS = 60;

function accessStore(): AccessStore {
  return {
    groups: store.groups(),
    memberships: store.memberships(),
    profiles: store.profiles(),
  };
}

/** Отметки ребёнка: только три счётчика, без содержимого. */
function marksOf(profileId: string) {
  const schedule = store.programState(profileId)?.lessons ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const summary = attendanceSummary(schedule, today);
  const showcases = schedule.filter(
    (entry) =>
      entry.attended === true &&
      (YEAR.lessons.find((lesson) => lesson.number === entry.lesson)?.isShowcase ?? false),
  ).length;
  return { attended: summary.attended, missed: summary.missed, showcases };
}

/**
 * Номер следующего занятия для группы: по расписанию её первого ребёнка.
 *
 * Если в группе пока никого нет, расписания нет и «следующего» занятия тоже:
 * выдумывать первое занятие было бы враньём о дате.
 */
function nextLessonNumber(groupId: string | undefined): number | null {
  if (!groupId) return null;
  const membership = store.memberships().find((row) => row.groupId === groupId);
  if (!membership) return null;
  const schedule = store.programState(membership.profileId)?.lessons ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const next = nextLesson(schedule, today);
  return next?.lesson ?? null;
}

export async function GET(req: Request) {
  const parentId = requestParent(req);
  if (!parentId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!rateLimit(clientKey(req, 'teacher', parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const groups = store.groupsByTeacher(parentId);
  const storeValue = accessStore();

  return NextResponse.json({
    // Педагог без групп видит пустой список, а не ошибку: он может быть
    // родителем, который ещё не создал группу.
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      year: group.year,
      joinCode: group.joinCode,
      students: groupStudents(storeValue, parentId, group.id, marksOf),
    })),
    canMark: groups.length > 0,
    /**
     * План следующей встречи. Педагог открывает кабинет перед занятием и видит,
     * что делать 40 минут: без этого расписание есть, а занятия нет.
     *
     * План отдаётся целиком на все занятия сразу: список общий, не зависит от
     * ребёнка, и грузить его по одному значило бы тридцать шесть запросов.
     */
    plan: {
      minutes: MEETING_MINUTES,
      // Ближайшее занятие по календарю первой группы: у групп годы могут
      // начинаться в разные даты, и «следующее» у каждой своё.
      next: nextLessonNumber(groups[0]?.id),
      lessons: YEAR.lessons.map((lesson) => meetingPlan(lesson)),
    },
  });
}

export async function POST(req: Request) {
  const parentId = requestParent(req);
  if (!parentId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!rateLimit(clientKey(req, 'teacher-post', parentId), 240)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { action, profileId, lesson, attended, code, groupId, reason, ...rest } = body as Record<string, unknown>;

  // Причина отсутствия не собирается: чувствительное поле. Отказ явный, чтобы
  // не оставить уверенности, что данные сохранились.
  if (reason !== undefined) return NextResponse.json({ error: 'reason_not_collected' }, { status: 400 });
  if (Object.keys(rest).length > 0) return NextResponse.json({ error: 'unexpected_fields' }, { status: 400 });

  if (action === 'join') return joinGroup(parentId, code, profileId);
  if (action === 'leave') return leaveGroup(parentId, groupId, profileId);
  if (action === 'mark') return markLesson(parentId, profileId, lesson, attended);

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}

function markLesson(parentId: string, profileId: unknown, lesson: unknown, attended: unknown) {
  if (typeof profileId !== 'string' || !profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (typeof lesson !== 'number' || !Number.isInteger(lesson) || lesson < 1 || lesson > MAX_LESSONS) {
    return NextResponse.json({ error: 'invalid_lesson' }, { status: 400 });
  }
  if (typeof attended !== 'boolean') return NextResponse.json({ error: 'invalid_attended' }, { status: 400 });

  return store.transaction(() => {
    // Права — через группу, а не по списку детей. Знание profileId доступа не даёт.
    if (!teacherCanMark(accessStore(), parentId, profileId)) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    }

    const state = store.programState(profileId);
    const schedule = state.lessons ?? [];
    const index = schedule.findIndex((entry) => entry.lesson === lesson);
    if (index === -1) return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });

    // Отметка не оценивает ребёнка и не двигает прогресс симулятора: она
    // фиксирует, был ли он на встрече. Поэтому меняется одно поле.
    const updated = schedule.map((entry, i) => (i === index ? { ...entry, attended } : entry));
    store.setProgramState({ ...state, lessons: updated });

    return NextResponse.json({
      lesson,
      attended,
      profileId,
      attendance: attendanceSummary(updated, new Date().toISOString().slice(0, 10)),
    });
  });
}

function joinGroup(parentId: string, code: unknown, profileId: unknown) {
  const clean = normalizeJoinCode(code);
  if (!clean) return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  if (typeof profileId !== 'string' || !profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });

  return store.transaction(() => {
    // Ребёнок должен быть своим: чужого ребёнка в группу не добавить.
    const profile = store.profile(profileId);
    if (!profile || profile.parentId !== parentId) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    }

    const group = store.groups().find((row) => row.joinCode === clean);
    if (!group) return NextResponse.json({ error: 'group_not_found' }, { status: 404 });

    // Педагог не может добавить себя и своего ребёнка к себе же: это не запрет
    // ради запрета, а защита от «группы из одного человека», где отметки
    // выглядят как данные, хотя это самоотчёт.
    if (group.teacherId === parentId) return NextResponse.json({ error: 'own_group' }, { status: 409 });

    if (store.memberships().some((row) => row.groupId === group.id && row.profileId === profileId)) {
      return NextResponse.json({ error: 'already_member' }, { status: 409 });
    }

    const membership: Membership = { groupId: group.id, profileId, joinedAt: Date.now() };
    store.addMembership(membership);

    // Родителю — минимум: название группы и год. Других детей в группе он не
    // видит: знать, кто ещё ходит, — это уже про чужих детей.
    return NextResponse.json({ joined: true, group: { name: group.name, year: group.year } });
  });
}

function leaveGroup(parentId: string, groupId: unknown, profileId: unknown) {
  if (typeof groupId !== 'string' || !groupId) return NextResponse.json({ error: 'groupId_required' }, { status: 400 });
  if (typeof profileId !== 'string' || !profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });

  return store.transaction(() => {
    const profile = store.profile(profileId);
    if (!profile || profile.parentId !== parentId) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    }
    store.removeMembership(groupId, profileId);
    // Отметки остаются: посещение было фактом, и забирать его при выходе из
    // группы — значит переписывать историю.
    return NextResponse.json({ left: true });
  });
}

/** Создание группы: только взрослый, у которого уже есть свой профиль ребёнка? Нет — любой взрослый. */
export async function PUT(req: Request) {
  const parentId = requestParent(req);
  if (!parentId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!rateLimit(clientKey(req, 'teacher-create', parentId), 10)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { name, year, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return NextResponse.json({ error: 'unexpected_fields' }, { status: 400 });
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 40) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }
  const groupYear = year === undefined ? new Date().getUTCFullYear() : year;
  if (typeof groupYear !== 'number' || !Number.isInteger(groupYear) || groupYear < 2000 || groupYear > 2100) {
    return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  }

  return store.transaction(() => {
    // Ограничение на число групп у одного педагога: без него один аккаунт
    // создаёт сотни групп, и код группы перестаёт что-либо значить.
    if (store.groupsByTeacher(parentId).length >= 12) {
      return NextResponse.json({ error: 'too_many_groups' }, { status: 409 });
    }
    // Код не должен совпасть с существующим: иначе ввод кода ведёт в чужую группу.
    let joinCode = newJoinCode();
    for (let attempt = 0; attempt < 5 && store.groups().some((row) => row.joinCode === joinCode); attempt += 1) {
      joinCode = newJoinCode();
    }
    if (store.groups().some((row) => row.joinCode === joinCode)) {
      return NextResponse.json({ error: 'try_again' }, { status: 503 });
    }

    const group = { id: `g_${parentId.slice(-8)}_${Date.now()}`, teacherId: parentId, name: name.trim(), year: groupYear, joinCode };
    store.addGroup(group);
    return NextResponse.json({ group: { id: group.id, name: group.name, year: group.year, joinCode: group.joinCode } });
  });
}
