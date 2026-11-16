'use client';

import Link from 'next/link';
import { useState } from 'react';

type OverviewPayload = {
  generatedAt: number;
  storage: {
    mode: string;
    asyncPool: { enabled: boolean; ok: boolean; latencyMs: number; totalCount: number; idleCount: number };
  };
  accounts: {
    families: number;
    profiles: number;
    withGuardianConsent: number;
    withVideoConsent: number;
    byAgeBand: Record<'5-7' | '8-10' | '11-13', number>;
    byMode: { family: number; group: number; child_solo: number };
  };
  billing: {
    activeSubscriptions: number;
    expiredSubscriptions: number;
    succeededPayments: number;
    refundedPayments: number;
    pendingPayments: number;
    grossRevenueRub: number;
    refundedRub: number;
    netRevenueRub: number;
    archivedLedgerRows: number;
  };
  retention: {
    completedSessions: number;
    activeProfiles7d: number;
    activeProfiles30d: number;
    milestones: {
      day1Plus: number;
      week1Complete: number;
      week4Complete: number;
      week8Complete: number;
      courseComplete60: number;
    };
  };
  groups: {
    totalGroups: number;
    enrolledProfiles: number;
    totalAttendedMarks: number;
    showcaseTotals: { level0: number; level1: number; level2: number };
  };
  research: {
    codingSamplesTotal: number;
    pairedSamples: number;
    cohenKappa: number | null;
    gwetAc1: number | null;
    verdict: string;
  };
};

type ResearchPayload = {
  protocol: {
    version: string;
    anchors: Record<'0' | '1' | '2', string>;
    showcaseLessons: { lesson: number; title: string; stage: string }[];
    blindingRule: string;
  };
  report: {
    sample: {
      participantsTotal: number;
      byAgeBand: Record<'5-7' | '8-10' | '11-13', number>;
      videoConsentGranted: number;
      completedSessionsTotal: number;
      activeGroups: number;
    };
    constructCoverage: {
      skillsTotal: number;
      skillsMapped: number;
      byConstruct: { id: string; label: string; skillsCount: number }[];
    };
    stageDynamics: Record<
      'entry' | 'mid' | 'final',
      { observations: number; level0: number; level1: number; level2: number }
    >;
    reliability: {
      pairedCount: number;
      pendingCount: number;
      observedAgreement: number | null;
      cohenKappa: number | null;
      weightedKappa: number | null;
      gwetAc1: number | null;
      confusionMatrix: [[number, number, number], [number, number, number], [number, number, number]];
      verdict: string;
    };
    limitations: string[];
  };
  samples: {
    sampleId: string;
    participantHash: string;
    ageBand: string;
    lesson: number;
    stage: string;
    raterA: { submitted: boolean; score?: number } | null;
    raterB: { submitted: boolean; score?: number } | null;
    paired: boolean;
  }[];
  consentedCandidates: { profileId: string; participantHash: string; ageBand: string }[];
};

const VERDICT_LABEL: Record<string, string> = {
  insufficient_data: 'Мало парных наблюдений (нужно не менее 10)',
  below_threshold: 'Ниже целевого порога согласованности',
  acceptable: 'Приемлемая надёжность (κ ≥ 0.70 / AC1 ≥ 0.75)',
  strong: 'Высокая надёжность (κ ≥ 0.80 и AC1 ≥ 0.85)',
};

const STAGE_LABEL: Record<'entry' | 'mid' | 'final', string> = {
  entry: 'Вход в год (занятия 1–12)',
  mid: 'Середина года (занятия 13–24)',
  final: 'Итог года (занятия 25–36)',
};

export default function AdminDashboard() {
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<'overview' | 'export' | 'research'>('overview');
  const [blindSlot, setBlindSlot] = useState<'rater_a' | 'rater_b'>('rater_a');
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [research, setResearch] = useState<ResearchPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Поля формы создания образца и ввода оценки оценщика
  const [newLesson, setNewLesson] = useState(3);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [anonBand, setAnonBand] = useState<'5-7' | '8-10' | '11-13'>('8-10');
  const [raterId, setRaterId] = useState('rater_1');
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [selectedScore, setSelectedScore] = useState<0 | 1 | 2>(1);

  const cleanToken = token.trim();

  async function loadAll(slotOverride?: 'rater_a' | 'rater_b') {
    if (!cleanToken) return;
    setBusy(true);
    setError('');
    setStatusMsg('');
    const slot = slotOverride ?? blindSlot;
    try {
      const headers = { Authorization: `Bearer ${cleanToken}` };
      const [ovRes, rsRes] = await Promise.all([
        fetch('/api/admin/overview', { headers }),
        fetch(`/api/admin/research?blindSlot=${slot}`, { headers }),
      ]);
      if (ovRes.status === 404 || rsRes.status === 404) {
        setOverview(null);
        setResearch(null);
        setError('Доступ отклонён: проверьте GIB_ADMIN_TOKEN.');
        return;
      }
      if (!ovRes.ok || !rsRes.ok) {
        setOverview(null);
        setResearch(null);
        setError('Сервис временно недоступен или сработал лимит запросов.');
        return;
      }
      const ovJson = (await ovRes.json()) as OverviewPayload;
      const rsJson = (await rsRes.json()) as ResearchPayload;
      setOverview(ovJson);
      setResearch(rsJson);
      if (rsJson.protocol.showcaseLessons.length > 0 && !rsJson.protocol.showcaseLessons.some((l) => l.lesson === newLesson)) {
        setNewLesson(rsJson.protocol.showcaseLessons[0].lesson);
      }
    } catch {
      setError('Не удалось связаться с сервером.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadDataset(dataset: 'sessions' | 'showcases' | 'retention' | 'irr', format: 'csv' | 'json' | 'xapi') {
    if (!cleanToken) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/export?dataset=${dataset}&format=${format}`, {
        headers: { Authorization: `Bearer ${cleanToken}` },
      });
      if (!res.ok) {
        setError('Не удалось подготовить выгрузку.');
        return;
      }
      const blob = await res.blob();
      const ext = format === 'xapi' ? 'xapi.json' : format;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gib-${dataset}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMsg(`Выгрузка ${dataset} (${format.toUpperCase()}) скачана.`);
    } catch {
      setError('Сбой при скачивании выгрузки.');
    } finally {
      setBusy(false);
    }
  }

  async function createSample() {
    if (!cleanToken) return;
    setBusy(true);
    setError('');
    setStatusMsg('');
    try {
      const payload = selectedProfileId
        ? { action: 'create_sample', profileId: selectedProfileId, lesson: newLesson }
        : { action: 'create_sample', anonymousKey: anonKey, ageBand: anonBand, lesson: newLesson };
      const res = await fetch('/api/admin/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          err.error === 'video_consent_required'
            ? 'У выбранного профиля нет отдельного согласия на съёмку показа.'
            : 'Не удалось создать запись для кодирования (проверьте поля).',
        );
        return;
      }
      const created = (await res.json()) as { sample: { sampleId: string } };
      setSelectedSampleId(created.sample.sampleId);
      setAnonKey('');
      setStatusMsg(`Создана карточка наблюдения ${created.sample.sampleId}.`);
      await loadAll();
    } catch {
      setError('Сбой сети при создании карточки наблюдения.');
    } finally {
      setBusy(false);
    }
  }

  async function submitRating() {
    if (!cleanToken || !selectedSampleId) return;
    setBusy(true);
    setError('');
    setStatusMsg('');
    try {
      const res = await fetch('/api/admin/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanToken}`,
        },
        body: JSON.stringify({
          action: 'submit_rating',
          sampleId: selectedSampleId,
          slot: blindSlot,
          raterId,
          score: selectedScore,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          err.error === 'same_rater_conflict'
            ? 'Один и тот же оценщик не может заполнить и слот A, и слот B.'
            : 'Не удалось сохранить оценку кодировщика.',
        );
        return;
      }
      setStatusMsg(`Оценка для ${selectedSampleId} (${blindSlot === 'rater_a' ? 'Оценщик A' : 'Оценщик B'}) сохранена.`);
      await loadAll();
    } catch {
      setError('Сбой сети при сохранении оценки.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Панель управления и исследования</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Агрегированные показатели семей, оплат, удержания и исследовательского контура ВУЗа — без персональных данных и ответов детей.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link href="/admin/funnel">Воронка запуска →</Link>
          <Link href="/">← На главную</Link>
        </div>
      </div>

      <form
        className="card funnel-token"
        onSubmit={(e) => {
          e.preventDefault();
          void loadAll();
        }}
      >
        <label htmlFor="admin-token">Токен дежурного (`GIB_ADMIN_TOKEN`, в браузере не сохраняется)</label>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Минимум 16 символов"
        />
        <button type="submit" className="btn" disabled={busy || cleanToken.length < 16}>
          {busy ? 'Загружаем…' : 'Загрузить сводку'}
        </button>
      </form>

      {error && <p className="funnel-warning" role="alert">{error}</p>}
      {statusMsg && <p className="card small" role="status">{statusMsg}</p>}

      {!overview && !error && (
        <p className="muted">Введите токен администратора, чтобы загрузить показатели.</p>
      )}

      {overview && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={tab === 'overview' ? 'primary' : 'secondary'}
              onClick={() => setTab('overview')}
            >
              Бизнес и удержание
            </button>
            <button
              type="button"
              className={tab === 'export' ? 'primary' : 'secondary'}
              onClick={() => setTab('export')}
            >
              Экспорт CSV / xAPI
            </button>
            <button
              type="button"
              className={tab === 'research' ? 'primary' : 'secondary'}
              onClick={() => setTab('research')}
            >
              Исследование и кодирование (ВУЗ)
            </button>
          </div>

          {tab === 'overview' && (
            <div className="stack">
              {overview.storage.mode !== 'postgres' && (
                <p className="funnel-warning">
                  Хранилище работает в режиме <strong>{overview.storage.mode}</strong>. Для продакшена обязателен <code>GIB_STORE=postgres</code>.
                </p>
              )}

              <section className="card stack">
                <h2>Семьи и профили</h2>
                <div className="stat"><span>Семей (аккаунтов взрослых)</span><b>{overview.accounts.families}</b></div>
                <div className="stat"><span>Профилей детей всего</span><b>{overview.accounts.profiles}</b></div>
                <div className="stat"><span>Линейки: 5–7 / 8–10 / 11–13</span><b>{overview.accounts.byAgeBand['5-7']} / {overview.accounts.byAgeBand['8-10']} / {overview.accounts.byAgeBand['11-13']}</b></div>
                <div className="stat"><span>Режимы: семья / кружок / ребёнок сам</span><b>{overview.accounts.byMode.family} / {overview.accounts.byMode.group} / {overview.accounts.byMode.child_solo}</b></div>
                <div className="stat"><span>Согласие представителя / согласие на съёмку показа</span><b>{overview.accounts.withGuardianConsent} / {overview.accounts.withVideoConsent}</b></div>
              </section>

              <section className="card stack">
                <h2>Подписки и расчёты</h2>
                <div className="stat"><span>Активные подписки / истекшие</span><b>{overview.billing.activeSubscriptions} / {overview.billing.expiredSubscriptions}</b></div>
                <div className="stat"><span>Успешные оплаты / возвраты / в обработке</span><b>{overview.billing.succeededPayments} / {overview.billing.refundedPayments} / {overview.billing.pendingPayments}</b></div>
                <div className="stat"><span>Выручка брутто / возвращено / нетто</span><b>{overview.billing.grossRevenueRub} ₽ / {overview.billing.refundedRub} ₽ / {overview.billing.netRevenueRub} ₽</b></div>
                <div className="stat"><span>Обезличенный архив кассовых записей (`payment_ledger`)</span><b>{overview.billing.archivedLedgerRows}</b></div>
              </section>

              <section className="card stack">
                <h2>Удержание и прохождение программы</h2>
                <div className="stat"><span>Завершённых игровых сцен (без повторов)</span><b>{overview.retention.completedSessions}</b></div>
                <div className="stat"><span>Активных профилей за 7 дней / 30 дней</span><b>{overview.retention.activeProfiles7d} / {overview.retention.activeProfiles30d}</b></div>
                <div className="stat"><span>Прошли ≥ 1 дня / ≥ 1 нед. / ≥ 4 нед. / ≥ 8 нед. / все 60 дней</span><b>{overview.retention.milestones.day1Plus} / {overview.retention.milestones.week1Complete} / {overview.retention.milestones.week4Complete} / {overview.retention.milestones.week8Complete} / {overview.retention.milestones.courseComplete60}</b></div>
              </section>

              <section className="card stack">
                <h2>Очные группы и показы</h2>
                <div className="stat"><span>Учебных групп / детей в группах</span><b>{overview.groups.totalGroups} / {overview.groups.enrolledProfiles}</b></div>
                <div className="stat"><span>Отметок присутствия на встречах</span><b>{overview.groups.totalAttendedMarks}</b></div>
                <div className="stat"><span>Шкала показов (0 отказ / 1 по приглашению / 2 вышел сам)</span><b>{overview.groups.showcaseTotals.level0} / {overview.groups.showcaseTotals.level1} / {overview.groups.showcaseTotals.level2}</b></div>
                <div className="stat">
                  <span>Асинхронный пул PostgreSQL (`pg.Pool`)</span>
                  <b>
                    {overview.storage.asyncPool.enabled
                      ? `${overview.storage.asyncPool.ok ? 'активен' : 'ошибка'} (${overview.storage.asyncPool.latencyMs} мс, соединений ${overview.storage.asyncPool.totalCount})`
                      : 'не задействован (локальный режим)'}
                  </b>
                </div>
              </section>
            </div>
          )}

          {tab === 'export' && (
            <section className="card stack">
              <h2>Обезличенный экспорт данных для анализа и LRS</h2>
              <p className="muted small">
                Все идентификаторы заменены необратимыми HMAC-псевдонимами (`participant_hash`).
                Имена детей, контакты взрослых и выбранные реплики сценариев в выгрузку не входят.
              </p>
              <table className="funnel-steps">
                <caption>Доступные исследовательские таблицы</caption>
                <thead>
                  <tr>
                    <th>Набор</th>
                    <th>Состав</th>
                    <th>Форматы</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Сессии (`sessions`)</strong></td>
                    <td>Возрастная линейка, режим, день/неделя, компетенция, конструкты, длительность</td>
                    <td>
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('sessions', 'csv')}>CSV</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('sessions', 'json')}>JSON</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('sessions', 'xapi')}>xAPI 1.0.3</button>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Показы (`showcases`)</strong></td>
                    <td>Псевдоним группы и участника, встреча, этап года, якорь выхода 0 · 1 · 2</td>
                    <td>
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('showcases', 'csv')}>CSV</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('showcases', 'json')}>JSON</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('showcases', 'xapi')}>xAPI 1.0.3</button>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Удержание (`retention`)</strong></td>
                    <td>Когорта месяца, пройденные дни и недели, посещённые встречи, показы</td>
                    <td>
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('retention', 'csv')}>CSV</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('retention', 'json')}>JSON</button>
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Двойное кодирование (`irr`)</strong></td>
                    <td>Парные оценки оценщиков A и B по шкале 0 · 1 · 2 для расчёта κ и AC1</td>
                    <td>
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('irr', 'csv')}>CSV</button>{' '}
                      <button type="button" className="secondary" disabled={busy} onClick={() => downloadDataset('irr', 'json')}>JSON</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {tab === 'research' && research && (
            <div className="stack">
              <section className="card stack">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0 }}>Сводный отчёт для научного руководителя</h2>
                  <button type="button" className="secondary" onClick={() => window.print()}>
                    Печать отчёта
                  </button>
                </div>
                <p className="muted small">
                  Протокол {research.protocol.version}. {research.protocol.blindingRule}
                </p>
                <div className="stat"><span>Участников всего / с согласием на съёмку показа</span><b>{research.report.sample.participantsTotal} / {research.report.sample.videoConsentGranted}</b></div>
                <div className="stat"><span>Покрытие каталога конструктами исследования</span><b>{research.report.constructCoverage.skillsMapped} из {research.report.constructCoverage.skillsTotal}</b></div>
                <div className="stat"><span>Парных кодировок (A + B) / ожидают второго оценщика</span><b>{research.report.reliability.pairedCount} / {research.report.reliability.pendingCount}</b></div>
                <div className="stat"><span>Совпадение P_o / κ Коэна / взвешенная κ_w / AC1 Гвета</span><b>{research.report.reliability.observedAgreement ?? '—'} / {research.report.reliability.cohenKappa ?? '—'} / {research.report.reliability.weightedKappa ?? '—'} / {research.report.reliability.gwetAc1 ?? '—'}</b></div>
                <div className="stat"><span>Статус надёжности оценщиков</span><b>{VERDICT_LABEL[research.report.reliability.verdict] ?? research.report.reliability.verdict}</b></div>

                <h3>Динамика выходов на показ по этапам года</h3>
                <table className="funnel-steps">
                  <thead>
                    <tr>
                      <th>Этап</th>
                      <th>Наблюдений</th>
                      <th>0 · отказ</th>
                      <th>1 · по приглашению</th>
                      <th>2 · вышел сам</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['entry', 'mid', 'final'] as const).map((st) => {
                      const row = research.report.stageDynamics[st];
                      return (
                        <tr key={st}>
                          <td>{STAGE_LABEL[st]}</td>
                          <td>{row.observations}</td>
                          <td>{row.level0}</td>
                          <td>{row.level1}</td>
                          <td>{row.level2}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <ul className="muted small">
                  {research.report.limitations.map((lim) => <li key={lim}>{lim}</li>)}
                </ul>
              </section>

              <section className="card stack">
                <h2>Бланк слепого двойного кодирования показов</h2>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Режим рабочего места:</span>
                  {(['rater_a', 'rater_b'] as const).map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={blindSlot === slot ? 'primary' : 'secondary'}
                      onClick={() => {
                        setBlindSlot(slot);
                        void loadAll(slot);
                      }}
                    >
                      {slot === 'rater_a' ? 'Оценщик A (слепой ввод)' : 'Оценщик B (слепой ввод)'}
                    </button>
                  ))}
                </div>

                <h3>1. Зарегистрировать образец показа</h3>
                <div className="stack">
                  <label>
                    Встреча-показ
                    <select value={newLesson} onChange={(e) => setNewLesson(Number(e.target.value))}>
                      {research.protocol.showcaseLessons.map((l) => (
                        <option key={l.lesson} value={l.lesson}>
                          Встреча {l.lesson}: {l.title} ({l.stage})
                        </option>
                      ))}
                    </select>
                  </label>
                  {research.consentedCandidates.length > 0 && (
                    <label>
                      Профиль с действующим согласием на видеофиксацию (необязательно)
                      <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                        <option value="">— Внешний обезличенный шифр ВУЗа —</option>
                        {research.consentedCandidates.map((c) => (
                          <option key={c.profileId} value={c.profileId}>
                            Участник {c.participantHash} ({c.ageBand})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {!selectedProfileId && (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Шифр записи (например, video-01)"
                        value={anonKey}
                        onChange={(e) => setAnonKey(e.target.value)}
                      />
                      <select value={anonBand} onChange={(e) => setAnonBand(e.target.value as '5-7' | '8-10' | '11-13')}>
                        <option value="5-7">5–7 лет</option>
                        <option value="8-10">8–10 лет</option>
                        <option value="11-13">11–13 лет</option>
                      </select>
                    </div>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || (!selectedProfileId && anonKey.trim().length < 3)}
                    onClick={createSample}
                  >
                    Создать карточку наблюдения
                  </button>
                </div>

                <h3>2. Внести независимую оценку ({blindSlot === 'rater_a' ? 'Оценщик A' : 'Оценщик B'})</h3>
                <div className="stack">
                  <label>
                    Идентификатор оценщика
                    <input
                      type="text"
                      value={raterId}
                      onChange={(e) => setRaterId(e.target.value)}
                      placeholder="rater_1"
                    />
                  </label>
                  <label>
                    Карточка наблюдения
                    <select value={selectedSampleId} onChange={(e) => setSelectedSampleId(e.target.value)}>
                      <option value="">— Выберите карточку —</option>
                      {research.samples.map((s) => (
                        <option key={s.sampleId} value={s.sampleId}>
                          {s.sampleId} · участник {s.participantHash} · встреча {s.lesson}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Якорь шкалы выхода
                    <select value={selectedScore} onChange={(e) => setSelectedScore(Number(e.target.value) as 0 | 1 | 2)}>
                      <option value={0}>0 — {research.protocol.anchors['0']}</option>
                      <option value={1}>1 — {research.protocol.anchors['1']}</option>
                      <option value={2}>2 — {research.protocol.anchors['2']}</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !selectedSampleId || raterId.trim().length < 2}
                    onClick={submitRating}
                  >
                    Сохранить оценку
                  </button>
                </div>

                {research.samples.length > 0 && (
                  <table className="funnel-steps">
                    <caption>Журнал карточек кодирования (второй слот скрыт до парного завершения)</caption>
                    <thead>
                      <tr>
                        <th>Образец</th>
                        <th>Участник</th>
                        <th>Встреча</th>
                        <th>Оценщик A</th>
                        <th>Оценщик B</th>
                      </tr>
                    </thead>
                    <tbody>
                      {research.samples.map((s) => (
                        <tr key={s.sampleId}>
                          <td>{s.sampleId}</td>
                          <td>{s.participantHash} ({s.ageBand})</td>
                          <td>{s.lesson}</td>
                          <td>{s.raterA ? (s.raterA.score !== undefined ? String(s.raterA.score) : 'внесено (скрыто)') : '—'}</td>
                          <td>{s.raterB ? (s.raterB.score !== undefined ? String(s.raterB.score) : 'внесено (скрыто)') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
