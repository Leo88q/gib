'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type DataSummary = {
  profile: { name: string; age: number; createdAt?: number } | null;
  counts: { sessions: number; tasks: number; stories: number; familyMarks: number; feelings: number; events: number };
  feelings: { enabled: boolean; retentionDays: number; limit: number };
  updatedAt: number;
};

/**
 * Управление данными и согласиями в кабинете.
 *
 * В одном месте: что именно хранится о ребёнке (по категориям), какие решения
 * уже приняты взрослым и где каждое можно изменить или удалить. Содержимое
 * сохранённых отметок чувств здесь не показывается: доступ к нему — отдельное
 * юридическое решение, а не следствие входа в кабинет.
 */
export default function DataControls({ profileId, onExport, onDelete, busy }: {
  profileId: string;
  onExport: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [data, setData] = useState<DataSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await apiFetch(`/api/profile/data?profileId=${encodeURIComponent(profileId)}`, { signal: controller.signal });
        if (!res.ok) throw new Error('load_failed');
        const json = await res.json();
        if (!controller.signal.aborted) setData(json);
      } catch { if (!controller.signal.aborted) setError('Не удалось загрузить, какие данные хранятся.'); }
    })();
    return () => controller.abort();
  }, [profileId]);

  return <section className="panel data-controls" aria-label="Данные и согласия">
    <h2>🗂 Что мы храним и что можно решить</h2>
    {error && <p role="alert" className="request-error">{error}</p>}
    {!data && !error && <p role="status">Собираем сводку…</p>}
    {data && <>
      <p className="muted">
        {data.profile ? `Профиль «${data.profile.name}», ${data.profile.age} лет.` : 'Профиль ребёнка.'}
        {' '}Ниже — только категории и количество. Содержимое ответов, чувств и переписки мы не собираем.
      </p>
      <dl className="data-counts">
        <div><dt>Занятия</dt><dd>{data.counts.sessions}</dd></div>
        <div><dt>Задания</dt><dd>{data.counts.tasks}</dd></div>
        <div><dt>Истории</dt><dd>{data.counts.stories}</dd></div>
        <div><dt>Семейные отметки</dt><dd>{data.counts.familyMarks}</dd></div>
        <div><dt>Сохранённые чувства</dt><dd>{data.counts.feelings}</dd></div>
      </dl>

      <h3>Решения взрослого</h3>
      <ul className="data-decisions">
        <li>
          <strong>Отметки чувств.</strong>{' '}
          {data.feelings.enabled
            ? `Сохранение включено: хранится до ${data.feelings.retentionDays} дней, не больше ${data.feelings.limit} отметок. Изменить или отозвать — в блоке «Чувства и приватность» ниже; отзыв стирает сохранённое.`
            : 'Сохранение выключено: отметки живут только на экране и никуда не записываются. Включить — в блоке «Чувства и приватность» ниже.'}
        </li>
        <li>
          <strong>Уведомления.</strong>{' '}
          Мы не отправляем напоминания и рассылки о ребёнке. Если появятся, они будут только с отдельным согласием и ограничением частоты — по умолчанию выключены.
        </li>
        <li>
          <strong>Аналитика.</strong>{' '}
          Игровая аналитика не подключена. Журнал событий хранится на нашем сервере для отчёта и не передаётся третьим сторонам.
        </li>
      </ul>

      <h3>Забрать или удалить</h3>
      <p className="muted small">
        Выгрузка содержит всё, что связано с профилем, включая сохранённые отметки чувств и семейные отметки. Удаление убирает профиль, прогресс, сессии и подписку из текущего хранилища; в резервных копиях данные могут сохраниться дольше.
      </p>
      <div className="data-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={onExport}>Скачать данные ребёнка</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onDelete}>Удалить профиль и все данные</button>
      </div>
      <p className="muted small">
        Полное удаление из резервных копий и сроки хранения — отдельная процедура, которая появится вместе с политикой обработки данных. Сейчас удаление действует на текущее хранилище.
      </p>
    </>}
  </section>;
}
