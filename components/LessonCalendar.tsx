'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Календарь занятий года в кабинете родителя.
 *
 * Что показывает: 36 дат по неделе, что уже прошло, где ребёнок сейчас и когда
 * следующее занятие. Взрослый может отметить «был / не был».
 *
 * Чего здесь намеренно нет:
 *  - причины отсутствия. Поле не собирается: это чувствительные данные, и их
 *    сбор требует отдельного согласия и решения. Маршрут отвечает на такую
 *    попытку кодом `reason_not_collected`.
 *  - оценок. Отметка посещения — факт, а не оценка ребёнка. Здесь нет ни балла,
 *    ни процента «успеваемости», потому что посещаемость не про ребёнка.
 *  - «вы пропустили 4 занятия» как упрёка. Показывается сводка, а не укор:
 *    в семье могут быть болезни и переезды, и это не повод для сообщения.
 *
 * Почему проценты посещаемости не показываются ребёнку: ребёнок не должен
 * узнавать о себе через пропуски взрослых.
 */

type LessonEntry = {
  lesson: number;
  date: string;
  attended: boolean | null;
  unit: number | null;
  title: string;
  isShowcase: boolean;
};

type Attendance = {
  held: number;
  attended: number;
  missed: number;
  unmarked: number;
  share?: number;
};

type LessonsResponse = {
  lessons: LessonEntry[];
  attendance: Attendance;
  next: { lesson: number; date: string; readyFor: number; gap: 'calendar' | 'ahead' | 'behind'; attended: boolean | null } | null;
  total: number;
};

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export default function LessonCalendar({ profileId }: { profileId: string }) {
  const [data, setData] = useState<LessonsResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/lessons?profileId=${encodeURIComponent(profileId)}`);
      if (!response.ok) throw new Error('load');
      setData(await response.json());
      setError('');
    } catch {
      setError('Не удалось загрузить календарь занятий.');
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = async (lesson: number, attended: boolean) => {
    setBusy(lesson);
    try {
      const response = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId, lesson, attended }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          body?.error === 'reason_not_collected'
            ? 'Причина отсутствия не сохраняется: мы её не собираем.'
            : 'Не удалось сохранить отметку.',
        );
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <div className="card">
        <h2>Занятия</h2>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card">
        <h2>Занятия</h2>
        <p className="muted">Загружаем расписание…</p>
      </div>
    );
  }

  const { attendance, next } = data;
  const marked = attendance.attended + attendance.missed;

  return (
    <div className="card">
      <h2>Занятия: {data.total} за год</h2>

      <div className="stat">
        <span>Следующее занятие</span>
        <b>
          {next ? `${formatDate(next.date)} · занятие ${next.lesson}` : 'год закончен'}
        </b>
        {/* Если ребёнок прошёл дни вперёд, это говорится прямо. Иначе семья
            видит отставание там, где его нет, и решает, что прогресс потерялся. */}
        {next?.gap === 'ahead' && (
          <span className="muted">
            В приложении ребёнок уже дальше: по дням он готов к занятию {next.readyFor}. Встреча не
            переносится — её назначает школа.
          </span>
        )}
        {next?.gap === 'behind' && (
          <span className="muted">
            По дням в приложении ребёнок пока на занятии {next.readyFor}. Догнать можно в любой момент:
            дни не сгорают.
          </span>
        )}
      </div>

      <div className="stat">
        <span>Прошло занятий</span>
        <b>{attendance.held}</b>
      </div>

      <div className="stat">
        <span>Отмечено</span>
        <b>
          {marked > 0
            ? `${attendance.attended} был · ${attendance.missed} не был`
            : 'пока нет отметок'}
        </b>
      </div>

      {attendance.unmarked > 0 && (
        <p className="muted small">
          {attendance.unmarked} прошедших занятий без отметки. Отметьте их, если
          помните: это нужно только для того, чтобы понять, сколько занятий ребёнок
          действительно посетил.
        </p>
      )}

      {/* Доля посещаемости — для взрослого и только как факт. Не «успеваемость». */}
      {marked > 0 && attendance.share !== undefined && (
        <p className="muted small">
          Посещено {Math.round(attendance.share * 100)}% отмеченных занятий. Это факт
          для педагога, а не оценка ребёнка.
        </p>
      )}

      <button type="button" className="week-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? 'Скрыть расписание' : 'Показать все 36 дат'}
      </button>

      {open && (
        <div className="lesson-list">
          {data.lessons.map((entry) => {
            const status =
              entry.attended === true ? 'был' : entry.attended === false ? 'не был' : 'без отметки';
            return (
              <div className={`plan${entry.isShowcase ? ' current' : ''}`} key={entry.lesson}>
                <span className="muted">
                  {entry.lesson}. {formatDate(entry.date)}
                  {entry.isShowcase ? ' · показ' : ''}
                </span>
                <span className="muted small">
                  тема {entry.unit ?? '—'} · {entry.title} · {status}
                </span>
                <span className="lesson-actions">
                  <button
                    type="button"
                    className="week-toggle"
                    disabled={busy === entry.lesson}
                    onClick={() => void mark(entry.lesson, true)}
                    aria-label={`Отметить занятие ${entry.lesson}: был`}
                  >
                    был
                  </button>
                  <button
                    type="button"
                    className="week-toggle"
                    disabled={busy === entry.lesson}
                    onClick={() => void mark(entry.lesson, false)}
                    aria-label={`Отметить занятие ${entry.lesson}: не был`}
                  >
                    не был
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="muted small" role="status">{error}</p>}

      <p className="muted small">
        Отметки нужны, чтобы увидеть, сколько занятий ребёнок посетил. Причину
        отсутствия мы не записываем и не просим её указывать. Ребёнку эти отметки не
        показываются.
      </p>
    </div>
  );
}
