'use client';

/**
 * Экран отчёта по воронке запуска.
 *
 * Зачем экран, если есть `/api/admin/funnel`. До него числа воронки умел
 * прочитать только тот, кто помнит `curl` и токен: решение «где теряются
 * взрослые» принималось по JSON в терминале или не принималось вовсе. Экран
 * показывает те же числа из того же маршрута — он ничего не считает сам, чтобы
 * страница и API не разошлись.
 *
 * Как устроен доступ. Токен `GIB_ADMIN_TOKEN` вводится в поле и живёт только в
 * состоянии этой вкладки: он не пишется в `localStorage`, не попадает в адрес
 * страницы и не уходит на сервер ничем, кроме заголовка `Authorization` того же
 * маршрута, который и так его требует. Поэтому ссылку на экран можно держать
 * открытой, а токен — нет.
 *
 * Чего на экране нет: идентификаторов взрослых, имён детей и содержимого
 * ответов. API их не отдаёт, а экран не запрашивает.
 */
import React, { useState } from 'react';

type Step = { step: string; owners: number; conversion: number };

type Report = {
  verdict: string;
  steps: Step[];
  dropOffStep: string | null;
  paywallStops: Record<string, number>;
  accounts: { profiles: number; withConsent: number; lessonsInYear: number };
  storage: { events: number; retentionDays: number; backend: 'postgres' | 'file' };
  generatedAt: number;
};

/** Названия шагов человеческими словами: в API они технические. */
export const STEP_LABEL: Record<string, string> = {
  consent: 'Согласие взрослого',
  profile: 'Профиль ребёнка',
  first_session: 'Начал первое занятие',
  first_finished: 'Закончил первое занятие',
  paywall_seen: 'Увидел просьбу об оплате',
  paid: 'Оплатил',
};

/** Вердикт — одна строка, по которой принимают решение, а не набор чисел. */
export const VERDICT_LABEL: Record<string, string> = {
  no_traffic: 'Данных нет: ни один взрослый не дошёл до согласия',
  no_activation: 'Взрослые есть, но ни один ребёнок не начал занятие',
  no_payment: 'Занятия идут, оплат нет — смотреть шаг оплаты',
  working: 'Оплаты есть: воронка работает',
};

/** Проценты с одним знаком: 0,5% и 0% — разные вещи, округлять до целого нельзя. */
export function percent(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1).replace('.', ',')}%`;
}

export default function FunnelReport() {
  const [token, setToken] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!token.trim()) {
      setError('Вставьте токен администратора: без него отчёт закрыт.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/funnel', {
        headers: { authorization: `Bearer ${token.trim()}` },
        cache: 'no-store',
      });
      if (response.status === 404) {
        setReport(null);
        setError('Отчёт закрыт: токен не подошёл или GIB_ADMIN_TOKEN не задан на сервере.');
        return;
      }
      if (response.status === 429) {
        setReport(null);
        setError('Слишком много запросов. Подождите минуту и обновите.');
        return;
      }
      if (response.status === 503) {
        setReport(null);
        setError('Сервис закрыт заглушкой запуска: отчёт недоступен до снятия блокеров.');
        return;
      }
      if (!response.ok) {
        setReport(null);
        setError(`Отчёт не отдался: ответ ${response.status}.`);
        return;
      }
      setReport(await response.json() as Report);
    } catch {
      setReport(null);
      setError('Не удалось связаться с сервером. Проверьте соединение и повторите.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card funnel-report">
      <form className="funnel-token" onSubmit={load}>
        <label htmlFor="admin-token">Токен администратора</label>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          /*
            `onInput`, а не `onChange`: для текстового поля это один и тот же
            момент (в React `onChange` текстового ввода — обёртка над `input`),
            но нативное событие не зависит от внутреннего счётчика значения
            React и проверяется тестом на настоящем DOM. Поведение для
            пользователя то же: вставка, автозаполнение и набор с клавиатуры.
          */
          onInput={(event) => setToken(event.currentTarget.value)}
          placeholder="GIB_ADMIN_TOKEN"
        />
        <button type="submit" disabled={busy}>{busy ? 'Загружаем…' : 'Показать отчёт'}</button>
      </form>
      <p className="muted small">
        Токен не сохраняется: он уходит только в заголовке запроса и исчезает при закрытии вкладки.
      </p>

      {error && <p role="alert" className="request-error">{error}</p>}

      {!report && !error && (
        <p className="muted">
          Пока отчёт не запрошен, чисел нет. Пустая таблица здесь означала бы «нет трафика», а это
          разные вещи, поэтому экран ничего не показывает заранее.
        </p>
      )}

      {report && (
        <>
          <h2>{VERDICT_LABEL[report.verdict] ?? report.verdict}</h2>
          <table className="funnel-steps">
            <caption>Шаги за последние 30 дней, по уникальным взрослым</caption>
            <thead>
              <tr><th>Шаг</th><th>Взрослых</th><th>От предыдущего</th></tr>
            </thead>
            <tbody>
              {report.steps.map((step) => (
                <tr key={step.step} className={step.step === report.dropOffStep ? 'funnel-drop' : undefined}>
                  <td>{STEP_LABEL[step.step] ?? step.step}</td>
                  <td>{step.owners}</td>
                  <td>{percent(step.conversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {report.dropOffStep
              ? `Больше всего теряется на шаге «${STEP_LABEL[report.dropOffStep] ?? report.dropOffStep}».`
              : 'Сравнивать переходы пока не с чем: на первом шаге нет взрослых.'}
          </p>

          <h3>Отказ у оплаты</h3>
          {Object.keys(report.paywallStops).length === 0 ? (
            <p className="muted">Никто не остановился у оплаты.</p>
          ) : (
            <ul className="funnel-paywall">
              {Object.entries(report.paywallStops)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([lesson, count]) => (
                  <li key={lesson}>встреча {lesson}: {count}</li>
                ))}
            </ul>
          )}

          <h3>Что лежит в хранилище</h3>
          <p>
            Событий воронки: {report.storage.events}, срок хранения — {report.storage.retentionDays} дней.
            Хранилище: {report.storage.backend === 'postgres' ? 'PostgreSQL' : 'файл рядом с приложением'}.
          </p>
          {report.storage.backend === 'file' && (
            <p className="funnel-warning">
              Воронка лежит в файле. В продакшене так нельзя: файл исчезает при пересборке контейнера,
              и отчёт покажет нули вместо потерь. Нужен режим <code>GIB_STORE=postgres</code>.
            </p>
          )}
          <p className="muted small">
            Профилей: {report.accounts.profiles}, из них с согласием: {report.accounts.withConsent}.
            В году {report.accounts.lessonsInYear} встреч. Отчёт собран {new Date(report.generatedAt).toLocaleString('ru-RU')}.
          </p>
        </>
      )}
    </section>
  );
}
