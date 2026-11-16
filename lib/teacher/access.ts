/**
 * Роль педагога: доступ к группе, но не к ребёнку.
 *
 * Зачем отдельный модуль. До этой правки в продукте было две роли: ребёнок и
 * взрослый-владелец аккаунта. Годовая программа с занятием раз в неделю
 * подразумевает третью: педагог, который ведёт группу. Без неё отметки ставит
 * каждый родитель за своего ребёнка — а тогда посещаемость есть у тех, чьи
 * родители аккуратны, и нет у остальных. Это уже не данные о программе, а
 * данные об аккуратности родителей.
 *
 * Главное ограничение модели доступа, и оно не обсуждается:
 *
 *   Педагог видит посещаемость группы. Педагог НЕ видит:
 *     - содержимое ответов, сценариев и рефлексии;
 *     - сохранённые чувства;
 *     - отчёты родителю;
 *     - ничего о ребёнке сверх имени, возраста и отметок.
 *
 * Причина не в бюрократии. Ребёнок говорил в приложении то, что говорил
 * взрослому в кабинете и, возможно, только ему. Журнал посещаемости — это
 * расписание, а не дневник наблюдений.
 *
 * Что даёт педагогу право доступа: членство в группе. Группа привязана к
 * педагогу, профиль ребёнка — к группе. Права не выдаются на конкретного
 * ребёнка «вручную»: иначе одна ошибка в интерфейсе открывает чужого ребёнка.
 */

import type { Profile } from '../types';

/** Группа: то, что ведёт один педагог в одном учебном году. */
export type Group = {
  id: string;
  /** Владелец-педагог: тот же формат идентификатора, что у родителя. */
  teacherId: string;
  name: string;
  /** Год начала занятий: две группы «Сентябрь» разных лет — разные группы. */
  year: number;
  /**
   * Код, который педагог называет родителям. Ребёнок попадает в группу только
   * после того, как родитель ввёл код: это согласие, а не добавление по
   * идентификатору.
   */
  joinCode: string;
};

/** Членство ребёнка в группе. */
export type Membership = {
  groupId: string;
  profileId: string;
  /** Когда ребёнка добавили в группу: по этому полю видно выбывание. */
  joinedAt: number;
};

export type Store = {
  groups: Group[];
  memberships: Membership[];
  profiles: Profile[];
};

/**
 * Что педагог видит о ребёнке. Ровно эти поля — и ни одного сверх.
 *
 * Тип намеренно узкий: если кто-то захочет показать педагогу больше, ему
 * придётся менять этот тип, а не «просто добавить поле» в компоненте.
 */
export type TeacherStudentView = {
  profileId: string;
  name: string;
  age: number;
  /** Сколько занятий отмечено «был» и «не был». Без оценок и без процентов. */
  attended: number;
  missed: number;
  /** Участие в показах: сколько раз ребёнок выходил показывать. Это факт. */
  showcases: number;
  /**
   * Сколько раз отказался выходить. Отдельное поле, а не «минус» из showcases:
   * решение методиста — отказавшийся ребёнок это отдельный показатель, иначе
   * отказ растворяется в среднем и перестаёт быть видимым.
   */
  refused: number;
};

/**
 * Имеет ли педагог доступ к профилю.
 *
 * Доступ есть только через членство в группе, которую ведёт этот педагог.
 * Проверка идёт по цепочке, а не по прямому списку профилей: так нельзя выдать
 * доступ «одному ребёнку», не добавив его в группу.
 */
export function teacherCanSee(store: Store, teacherId: string, profileId: string): boolean {
  const groupIds = new Set(store.groups.filter((group) => group.teacherId === teacherId).map((group) => group.id));
  if (groupIds.size === 0) return false;
  return store.memberships.some(
    (membership) => membership.profileId === profileId && groupIds.has(membership.groupId),
  );
}

/**
 * Дети группы. Только те, кого педагог действительно ведёт, и только с полями
 * `TeacherStudentView`.
 *
 * Отметки передаются аргументом, а не читаются из хранилища: модуль доступа не
 * должен знать про занятия. Это и держит его узким — здесь нельзя случайно
 * «дойти до» содержимого ответов.
 */
export function groupStudents(
  store: Store,
  teacherId: string,
  groupId: string,
  marks: (profileId: string) => { attended: number; missed: number; showcases: number; refused: number },
): TeacherStudentView[] {
  const group = store.groups.find((item) => item.id === groupId);
  if (!group || group.teacherId !== teacherId) return [];

  return store.memberships
    .filter((membership) => membership.groupId === groupId)
    .map((membership) => store.profiles.find((profile) => profile.id === membership.profileId))
    .filter((profile): profile is Profile => Boolean(profile))
    .map((profile) => {
      const summary = marks(profile.id);
      return {
        profileId: profile.id,
        name: profile.name,
        age: profile.age,
        attended: summary.attended,
        missed: summary.missed,
        showcases: summary.showcases,
        refused: summary.refused,
      };
    });
}

/**
 * Может ли педагог отметить занятие ребёнку. Отметка — это тоже доступ, и он
 * проверяется так же: через группу, не по списку детей.
 */
export function teacherCanMark(store: Store, teacherId: string, profileId: string): boolean {
  return teacherCanSee(store, teacherId, profileId);
}

/**
 * Педагог НЕ может ставить отметку за ребёнка из чужой группы, даже если знает
 * идентификатор профиля. Это проверяется отдельным тестом, а не комментарием.
 */
export const TEACHER_CANNOT_SEE = [
  'содержимое ответов в историях',
  'сохранённые чувства',
  'отчёт родителю',
  'уровень и опыт ребёнка',
  'выбранные варианты в сценариях',
] as const;
