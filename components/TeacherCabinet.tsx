'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

/**
 * Кабинет педагога: группа, дети, отметки.
 *
 * Что здесь есть и почему именно это. Педагогу нужно одно: за минуту после
 * занятия отметить, кто был. Всё остальное — темы, навыки, отчёты — уже есть в
 * других местах. Поэтому экран состоит из списка детей и одной кнопки на
 * ребёнка.
 *
 * Чего здесь нет намеренно:
 *  - баллов, уровней, прогресса ребёнка по дням;
 *  - ответов из историй, чувств, отчётов родителю;
 *  - «успеваемости» и любых слов, которые оценивают ребёнка.
 *
 * Доля посещаемости не показывается как процент: педагог видит «8 был · 1 не
 * был» и сам решает, с кем поговорить. Процент превращает факт в оценку.
 */

type Stage = { step: number; title: string; next: string; avoid: string };
type Hint = {
  headline: string;
  technique: { id: string; title: string; when: string; do: string; why: string };
  avoid: { phrase: string; effect: string; instead: string };
  needsTalk: boolean;
};

type Student = {
  profileId: string;
  name: string;
  age: number;
  attended: number;
  missed: number;
  showcases: number;
  refused: number;
  /** С какой ступени начинать и что делать дальше. */
  stage: Stage;
  /** Приём под текущую ситуацию и фраза, которую нельзя говорить. */
  hint: Hint;
  /** Сколько показов подряд без выхода. */
  refusalsInRow: number;
};

type Group = {
  id: string;
  name: string;
  year: number;
  joinCode: string;
  students: Student[];
};

type Method = {
  alignments: { lesson: number; wording: string; groups: string[] }[];
  coverage: { byGroup: Record<string, number>; byArea: Record<string, number>; lessonsByArea: Record<string, number[]> };
  pages: { lesson: number; trained: string; examples: { where: string; what: string }[]; noticeAtHome: string; fgosWording: string }[];
  demos: { items: { id: string; title: string; seconds: number; shot: string; says: string; mustSee: string }[]; totalMinutes: number };
  backup: { items: { id: string; title: string; situation: string; minutes: number; lead: string; why: string }[]; labels: Record<string, string> };
  refusalAlert: number;
  briefs: {
    items: {
      lesson: number;
      unitTitle: string;
      about: string;
      whatChildrenDo: string;
      why: string;
      watchFor: string;
      keep: string;
      askYourself: string;
      seconds: number;
    }[];
    totalMinutes: number;
  };
};

type MeetingPlan = {
  lesson: number;
  unitTitle: string;
  skills: string[];
  blocks: { title: string; minutes: number; lead: string; children: string }[];
  materials: string[];
  closing: string;
};

type Lessons = {
  lessons: { lesson: number; date: string; attended: boolean | null; title: string; isShowcase?: boolean }[];
  next: { lesson: number; date: string } | null;
};

/**
 * `apiFetch` сам подставляет подпись платформы (Telegram / MAX). Своих заголовков
 * авторизации компонент не ставит: иначе демо-заголовок просочился бы в продукт.
 */
export default function TeacherCabinet() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [plan, setPlan] = useState<{ minutes: number; next: number | null; lessons: MeetingPlan[] } | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [newName, setNewName] = useState('');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Record<string, Lessons>>({});
  const [marked, setMarked] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/teacher');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        groups: Group[];
        plan?: { minutes: number; next: number | null; lessons: MeetingPlan[] };
        method?: Method;
      };
      setGroups(data.groups);
      setPlan(data.plan ?? null);
      setMethod(data.method ?? null);
      setError('');
    } catch {
      // Сбой загрузки — это не «группа пустая». Разница важна: иначе педагог
      // решит, что детей нет, и не заметит, что просто нет связи.
      setError('Не удалось загрузить группу. Попробуйте обновить страницу.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLessons = async (profileId: string) => {
    if (lessons[profileId]) return;
    try {
      const res = await apiFetch(`/api/lessons?profileId=${encodeURIComponent(profileId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as Lessons;
      setLessons((prev) => ({ ...prev, [profileId]: data }));
    } catch {
      /* тихо: отметка всё равно доступна по номеру ближайшего занятия */
    }
  };

  const createGroup = async () => {
    if (!newName.trim()) return;
    setBusy('create');
    try {
      const res = await apiFetch('/api/teacher', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = (await res.json()) as { group?: Group; error?: string };
      if (data.group) {
        setNewName('');
        await load();
      } else {
        setError(`Группа не создана: ${data.error ?? 'неизвестная ошибка'}`);
      }
    } finally {
      setBusy('');
    }
  };

  /**
   * Отметка показа: 0, 1, 2.
   *
   * Три кнопки вместо «выступил / не выступил», потому что движение от отказа к
   * самостоятельности — и есть результат актёрской методики. Две кнопки этого
   * не различают: «вышел после приглашения» и «вышел сам» — разные вещи.
   */
  const markShowcaseLevel = async (profileId: string, level: 0 | 1 | 2) => {
    const target = lessons[profileId]?.next?.lesson;
    if (!target) {
      setMarked((prev) => ({ ...prev, [profileId]: 'Нет расписания занятий' }));
      return;
    }
    setBusy(`${profileId}:showcase`);
    try {
      const res = await apiFetch('/api/teacher', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'showcase', profileId, lesson: target, level }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const reason =
          data.error === 'not_a_showcase'
            ? 'Это занятие не показ'
            : data.error === 'profile_not_found'
              ? 'Этот ребёнок не в вашей группе'
              : 'Не сохранилось';
        setMarked((prev) => ({ ...prev, [profileId]: reason }));
        return;
      }
      // Отказ — не «минус», а результат: подпись говорит это прямо, чтобы
      // педагог не считал его провалом ребёнка.
      const label = level === 0 ? 'отказался выходить' : level === 1 ? 'вышел по приглашению' : 'вышел сам';
      setMarked((prev) => ({ ...prev, [profileId]: `Показ ${target}: ${label}` }));
      await load();
    } finally {
      setBusy('');
    }
  };

  const mark = async (profileId: string, attended: boolean) => {
    const target = lessons[profileId]?.next?.lesson;
    if (!target) {
      setMarked((prev) => ({ ...prev, [profileId]: 'Нет расписания занятий' }));
      return;
    }
    setBusy(`${profileId}:${target}`);
    try {
      const res = await apiFetch('/api/teacher', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'mark', profileId, lesson: target, attended }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMarked((prev) => ({ ...prev, [profileId]: data.error === 'profile_not_found' ? 'Этот ребёнок не в вашей группе' : 'Не сохранилось' }));
        return;
      }
      setMarked((prev) => ({ ...prev, [profileId]: `Занятие ${target}: ${attended ? 'был' : 'не был'}` }));
      await load();
    } finally {
      setBusy('');
    }
  };

  if (error) {
    return (
      <section className="panel">
        <h2>Моя группа</h2>
        <p className="muted">{error}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          Обновить
        </button>
      </section>
    );
  }

  if (!groups) {
    return (
      <section className="panel">
        <h2>Моя группа</h2>
        <p className="muted">Загружаю…</p>
      </section>
    );
  }

  if (groups.length === 0) {
    return (
      <section className="panel">
        <h2>Моя группа</h2>
        <p className="muted">
          Здесь можно вести группу: отмечать, кто был на занятии. Родители добавляют детей сами — по коду,
          который вы им назовёте. Без их согласия ребёнок в группу не попадёт.
        </p>
        <div className="row">
          <input
            className="input"
            placeholder="Название группы, например 4Б"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={40}
          />
          <button type="button" className="btn primary" disabled={busy === 'create'} onClick={() => void createGroup()}>
            Создать группу
          </button>
        </div>
      </section>
    );
  }

  /** Ближайшее занятие — показ? Тогда вместо «был / не был» три кнопки выхода. */
  const isNextShowcase = (profileId: string) => {
    const next = lessons[profileId]?.next;
    if (!next) return false;
    return lessons[profileId]?.lessons.find((item) => item.lesson === next.lesson)?.isShowcase === true;
  };

  // Ближайшее занятие и его план: педагог открывает кабинет перед встречей.
  const nextPlan = plan?.next ? plan.lessons.find((item) => item.lesson === plan.next) : undefined;

  return (
    <section className="panel">
      {nextPlan && (
        <div className="teacher-plan">
          <h2>Встреча {nextPlan.lesson}: {nextPlan.unitTitle}</h2>
          <p className="muted">
            {plan?.minutes ?? 40} минут · навыки: {nextPlan.skills.join(', ')}
          </p>
          {nextPlan.blocks.map((block) => (
            <div key={block.title} className="teacher-block">
              <strong>
                {block.minutes} мин · {block.title}
              </strong>
              <p className="muted">{block.lead}</p>
              {block.children && <p className="muted">{block.children}</p>}
            </div>
          ))}
          <p className="muted">Взять с собой: {nextPlan.materials.join('; ')}</p>
          <p className="muted">{nextPlan.closing}</p>
          {plan && plan.lessons.length > 1 && (
            <details>
              <summary className="muted">Все 36 планов</summary>
              {plan.lessons.map((item) => (
                <p key={item.lesson} className="muted">
                  {item.lesson}. {item.unitTitle} — {item.blocks.map((block) => `${block.minutes} мин ${block.title.split(':')[0]}`).join(', ')}
                </p>
              ))}
            </details>
          )}
        </div>
      )}

      {method && (
        <details className="teacher-method">
          <summary>
            <strong>Методическая подложка</strong> — ФГОС, страницы занятий, как вести
          </summary>

          <h3>Что происходит на занятии и зачем</h3>
          <p className="muted">
            {method.briefs.items.length} разборов, {method.briefs.totalMinutes} минут на все. Один — меньше
            минуты: читается перед занятием, а не вместо плана.
          </p>
          {method.briefs.items.slice(0, 4).map((brief) => (
            <details key={brief.lesson}>
              <summary className="muted">
                Занятие {brief.lesson}: {brief.unitTitle} · {brief.seconds} сек
              </summary>
              <p className="muted">О чём: {brief.about}</p>
              <p className="muted">Что делают: {brief.whatChildrenDo}</p>
              <p className="muted">Зачем: {brief.why}</p>
              <p className="muted">На что смотреть: {brief.watchFor}</p>
              <p className="muted">Не потерять: {brief.keep}</p>
              <p className="muted">Спросить себя: {brief.askYourself}</p>
            </details>
          ))}
          <details>
            <summary className="muted">Все {method.briefs.items.length} разборов</summary>
            {method.briefs.items.slice(4).map((brief) => (
              <p key={brief.lesson} className="muted">
                {brief.lesson}. {brief.unitTitle} — {brief.about} ({brief.seconds} сек)
              </p>
            ))}
          </details>

          <h3>Как показывать занятие школе</h3>
          <p className="muted">
            Формулировки для рабочей программы: {method.alignments.length} занятий, результаты ФГОС.
            Их можно показать завучу — это язык, на котором школа слышит.
          </p>
          <p className="muted">
            Коммуникация — в {method.coverage.byArea.communication ?? 0} занятиях, саморегуляция —{' '}
            {method.coverage.byArea.self_regulation ?? 0}, рефлексия — {method.coverage.byArea.reflection ?? 0}.
          </p>

          <h3>Как вести: что показать, а не рассказать</h3>
          <p className="muted">
            {method.demos.items.length} роликов, {method.demos.totalMinutes} минут на все. Смотреть по блоку,
            к которому готовитесь.
          </p>
          {method.demos.items.map((demo) => (
            <details key={demo.id}>
              <summary className="muted">
                {demo.title} · {Math.round(demo.seconds / 60)} мин
              </summary>
              <p className="muted">В кадре: {demo.shot}</p>
              <p className="muted">Говорит: {demo.says}</p>
              <p className="muted">Должно быть видно: {demo.mustSee}</p>
            </details>
          ))}

          <h3>Если группа не готова к плану</h3>
          <p className="muted">
            Запас не отменяет занятие: сохраняется форма — круг, этюд, итог.
          </p>
          {Object.entries(method.backup.labels).map(([situation, label]) => {
            const items = method.backup.items.filter((item) => item.situation === situation).slice(0, 2);
            if (items.length === 0) return null;
            return (
              <details key={situation}>
                <summary className="muted">{label}</summary>
                {items.map((item) => (
                  <p key={item.id} className="muted">
                    <strong>{item.title}</strong> ({item.minutes} мин): {item.lead}
                  </p>
                ))}
              </details>
            );
          })}

          <h3>Что тренировали: страница для родителя</h3>
          {method.pages.slice(0, 3).map((page) => (
            <details key={page.lesson}>
              <summary className="muted">
                Занятие {page.lesson}: {page.trained}
              </summary>
              {page.examples.map((example) => (
                <p key={example.where} className="muted">
                  {example.where}: {example.what}
                </p>
              ))}
              <p className="muted">Дома: {page.noticeAtHome}</p>
              <p className="muted">{page.fgosWording}</p>
            </details>
          ))}
        </details>
      )}

      <h2>Моя группа</h2>
      {groups.map((group) => (
        <div key={group.id} className="teacher-group">
          <div className="row">
            <strong>
              {group.name} · {group.year}
            </strong>
            <span className="chip">Код для родителей: {group.joinCode}</span>
          </div>
          <p className="muted">
            Назовите код родителям — они добавят ребёнка сами. Отметки ставятся за ближайшее занятие.
          </p>

          {group.students.length === 0 && <p className="muted">Пока никого нет: ждём, когда родители введут код.</p>}

          {group.students.map((student) => (
            <div key={student.profileId} className="teacher-student">
              <div className="row">
                <strong>{student.name}</strong>
                <span className="muted">
                  {student.age} лет · {student.attended} был · {student.missed} не был · {student.showcases} показов
                  {student.refused > 0 ? ` · ${student.refused} отказался` : ''}
                </span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setOpenGroup(student.profileId);
                    void loadLessons(student.profileId);
                  }}
                >
                  Отметить
                </button>
              </div>

              {/*
                Подсказка видна без клика. Педагог открывает кабинет на две
                минуты перед занятием, и ему нужно не «что-то нажать», а сразу
                знать, с чего начинать с этим ребёнком.

                Три отказа подряд выделены отдельно: это уже не случайность, и
                разговор важнее уговоров.
              */}
              {student.hint.needsTalk ? (
                <div className="teacher-hint teacher-hint-alert">
                  <strong>{student.hint.headline}</strong>
                  <p className="muted">
                    {student.refusalsInRow} показа подряд без выхода. Ступень: {student.stage.title}.
                  </p>
                  <p className="muted">Что сделать: {student.hint.technique.do}</p>
                  <p className="muted">Не говорить: {student.hint.avoid.phrase}</p>
                </div>
              ) : (
                <details className="teacher-hint">
                  <summary className="muted">
                    Ступень {student.stage.step}: {student.stage.title}
                  </summary>
                  <p className="muted">Дальше: {student.stage.next}</p>
                  <p className="muted">Избегать: {student.stage.avoid}</p>
                  <p className="muted">Приём: {student.hint.technique.title} — {student.hint.technique.do}</p>
                  <p className="muted">Не говорить: {student.hint.avoid.phrase}. Лучше: {student.hint.avoid.instead}</p>
                </details>
              )}

              {openGroup === student.profileId && (
                <div className="row">
                  <span className="muted">
                    {lessons[student.profileId]?.next
                      ? `Ближайшее занятие ${lessons[student.profileId]?.next?.lesson} · ${lessons[student.profileId]?.next?.date}`
                      : 'Расписание загружается…'}
                  </span>
                  {isNextShowcase(student.profileId) ? (
                    <>
                      <button type="button" className="btn small" onClick={() => void markShowcaseLevel(student.profileId, 0)}>
                        Отказался
                      </button>
                      <button type="button" className="btn small" onClick={() => void markShowcaseLevel(student.profileId, 1)}>
                        Вышел после приглашения
                      </button>
                      <button type="button" className="btn small" onClick={() => void markShowcaseLevel(student.profileId, 2)}>
                        Вышел сам
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy === `${student.profileId}:${lessons[student.profileId]?.next?.lesson}`}
                        onClick={() => void mark(student.profileId, true)}
                      >
                        Был
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy === `${student.profileId}:${lessons[student.profileId]?.next?.lesson}`}
                        onClick={() => void mark(student.profileId, false)}
                      >
                        Не был
                      </button>
                    </>
                  )}
                  {marked[student.profileId] && <span className="muted">{marked[student.profileId]}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <p className="muted">
        Вы видите посещаемость. Ответы детей, их чувства и отчёты родителям вам не показываются — так и задумано.
      </p>
    </section>
  );
}
