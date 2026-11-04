'use client';
import Link from 'next/link';
import PracticeMap from '@/components/PracticeMap';
import FamilyIdeas from '@/components/FamilyIdeas';
import FamilyGoal from '@/components/FamilyGoal';
import DataControls from '@/components/DataControls';
import NotificationSettings from '@/components/NotificationSettings';
import FeelingsConsent from '@/components/FeelingsConsent';
import ParentGate from '@/components/ParentGate';
import ParentPinSettings from '@/components/ParentPinSettings';

import { removeProfileSwitchDrafts } from '@/lib/switch-draft';
import { removeProfileSelectionDrafts } from '@/lib/selection-draft';
import { removeProfileExerciseDrafts } from '@/lib/exercise-draft';
import { removeProfileJourneyResumes } from '@/components/useJourneyResume';
import { PENDING_ANSWER_KEY, parsePendingAnswer } from '@/lib/pending-answer';

import { competencyArt, skillArt, DEFAULT_ART } from '@/lib/art-paths';
import { TIME_ZONES, profileZone } from '@/lib/calendar';
import { apiFetch } from '@/lib/telegramClient';

import { useEffect, useState } from 'react';

type Report = {
  weekStart: number;
  minutes: number;
  sessions: number;
  tasksDone: number;
  assistedTasks: number;
  scenariosDone: number;
  supportPracticesDone: number;
  skills: { skill: string; label: string; delta: number | null; ability: number }[];
  win: string;
  growth: string;
  home: string;
  question: string;
  scenarioNotes: { scenarioId: string; text: string }[];
  program: {
    week: number;
    weekTitle: string;
    day: number;
    dayTheme: string;
    completedDays: number;
    totalDays: number;
    finished: boolean;
  };
  player: {
    level: number;
    levelTitle: string;
    xp: number;
    coins: number;
    stars: number;
    badges: number;
    days: number;
    perfectDays: number;
  };
};

/** Отчёт по журналу технических событий: только завершённые занятия, с источниками. */
type EventsReport = {
  from: number;
  to: number;
  student: { sessions: number; minutes: number; tasks: number; excludedTasks: number; stories: number; practices: number; skippedPractices: number; stars: number };
  skills: { skill: string; accuracy: number | null; tasks: number; excluded: number }[];
  sources: { event: string; version: 1; records: number }[];
  limits: string[];
};

type ProgramDay = {
  day: number;
  theme: string;
  title: string;
  focus: string;
  parentGoal: string;
  done: boolean;
  current: boolean;
};

type ProgramWeek = {
  week: number;
  title: string;
  subtitle: string;
  competency: string;
  parentNote: string;
  homeIdeas: string[];
  weekQuestion: string;
  art: string;
  days: ProgramDay[];
};

type Sub = { plan: string; status: string; until: number } | null;

const PLAN_TITLES: Record<string, string> = {
  month: 'Месяц',
  year: 'Год',
  year_pro: 'Год с экспертом',
};

const COMPETENCY_LABEL: Record<string, string> = {
  self_awareness: 'Самопознание',
  self_regulation: 'Саморегуляция',
  empathy: 'Эмпатия',
  relationships: 'Навыки отношений',
  decision_making: 'Ответственные решения',
  creative_thinking: 'Творческое мышление',
  growth_mindset: 'Мышление роста',
};

/** Кабинет обёрнут воротами PIN: если взрослый задал код, вход требует его. */
export default function ParentPageWrapper() {
  return <ParentGate><ParentPage /></ParentGate>;
}

function ParentPage() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ name: string; age: number; band: string; timeZone?: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [eventsReport, setEventsReport] = useState<EventsReport | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [plans, setPlans] = useState<Record<string, { title: string; price: number; perks: string[] }>>({});
  const [program, setProgram] = useState<{
    progress: { completedDays: number; totalDays: number; finished: boolean; currentWeek: number };
    weeks: ProgramWeek[];
    reviewOff?: boolean;
  } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [billingError, setBillingError] = useState('');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [dataError, setDataError] = useState('');
  const [dataBusy, setDataBusy] = useState(false);
  const [selectedZone, setSelectedZone] = useState('Europe/Moscow');
  const [zoneMessage, setZoneMessage] = useState('');
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'no-profile' | 'error'>('loading');
  const [children, setChildren] = useState<{ id: string; name: string; age: number }[]>([]);

  useEffect(() => {
    const url = new URL(window.location.href);
    let id = url.searchParams.get('profileId');
    if (!id) { try { id = localStorage.getItem('gib:profileId'); } catch { /* storage is optional */ } }
    if (!id) { setLoadingState('no-profile'); return; }
    const controller = new AbortController();
    setProfileId(id);
    void (async () => {
      try {
        const fetchJson = async (path: string) => {
          const response = await apiFetch(path, { signal: controller.signal });
          if (!response.ok) throw new Error('load_failed');
          return response.json();
        };
        const safeId = encodeURIComponent(id);
        void apiFetch('/api/profile')
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d && Array.isArray(d.profiles) && !controller.signal.aborted) setChildren(d.profiles); })
          .catch(() => { /* список детей не обязателен для отчёта */ });
        const [rep, sb, pr] = await Promise.all([
          fetchJson(`/api/report?profileId=${safeId}`),
          fetchJson(`/api/subscribe?profileId=${safeId}`),
          fetchJson(`/api/program?profileId=${safeId}`),
        ]);
        if (controller.signal.aborted) return;
        if (!rep.profile || !rep.report) throw new Error('invalid_report');
        setProfile(rep.profile); setSelectedZone(profileZone(rep.profile.timeZone)); setReport(rep.report);
        setEventsReport(rep.events ?? null);
        setSub(sb.subscription ?? null); setPlans(sb.plans ?? {});
        setBillingAvailable(Boolean(sb.available));
        if (pr.weeks) { setProgram(pr); setOpenWeek(pr.progress.currentWeek ?? 1); }
        setLoadingState('ready');
      } catch { if (!controller.signal.aborted) setLoadingState('error'); }
    })();
    return () => controller.abort();
  }, []);

  const saveZone = async () => {
    if (!profileId || dataBusy) return;
    setDataBusy(true); setZoneMessage('');
    try {
      const res = await apiFetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, timeZone: selectedZone }) });
      if (!res.ok) throw new Error('update_failed');
      const updated = await res.json();
      const rep = await apiFetch(`/api/report?profileId=${encodeURIComponent(profileId)}`);
      if (!rep.ok) throw new Error('report_failed');
      const updatedReport = await rep.json();
      setProfile(updated.profile); setReport(updatedReport.report); setEventsReport(updatedReport.events ?? null);
      setZoneMessage('Часовой пояс сохранён. Недельный отчёт обновлён.');
    } catch { setZoneMessage('Не удалось обновить данные. Проверьте соединение и попробуйте снова.'); }
    finally { setDataBusy(false); }
  };

  // Выключатель повторов: решение взрослого, не оценка ребёнка. Прогресс не меняется.
  const toggleReview = async (reviewOff: boolean) => {
    if (!profileId || reviewBusy) return;
    setReviewBusy(true); setReviewMessage('');
    try {
      const res = await apiFetch('/api/program', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, reviewOff }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error('save_failed');
      setProgram(current => current ? { ...current, reviewOff: data.reviewOff } : current);
      setReviewMessage(data.notice);
    } catch { setReviewMessage('Не удалось сохранить настройку повторов. Попробуйте снова.'); }
    finally { setReviewBusy(false); }
  };

  const exportProfile = async () => {
    if (!profileId || dataBusy) return;
    setDataBusy(true); setDataError('');
    try {
      const res = await apiFetch(`/api/profile/export?profileId=${encodeURIComponent(profileId)}`);
      if (!res.ok) throw new Error('export_failed');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url; link.download = 'gib-profile.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setDataError('Не удалось скачать данные. Проверьте соединение и попробуйте снова.'); }
    finally { setDataBusy(false); }
  };

  const deleteProfile = async () => {
    if (!profileId || dataBusy || !window.confirm('Удалить профиль и весь игровой прогресс из текущего хранилища? В резервных копиях данные могут сохраниться. Это действие нельзя отменить.')) return;
    setDataBusy(true); setDataError('');
    try {
      const res = await apiFetch(`/api/profile?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) {
        setDataError(result.error === 'payment_in_progress'
          ? 'Платёж ещё не завершён. Удаление временно недоступно до проверки платежа.'
          : 'Не удалось удалить профиль. Проверьте соединение и попробуйте снова.');
        return;
      }
      try { localStorage.removeItem('gib:profileId'); } catch { /* storage is optional */ }
      try { if (parsePendingAnswer(sessionStorage.getItem(PENDING_ANSWER_KEY), profileId)) sessionStorage.removeItem(PENDING_ANSWER_KEY); removeProfileSwitchDrafts(sessionStorage, profileId); removeProfileSelectionDrafts(sessionStorage, profileId); removeProfileExerciseDrafts(sessionStorage, profileId); removeProfileJourneyResumes(sessionStorage, profileId); } catch { /* storage may be disabled */ }
      window.location.assign('/');
    } catch { setDataError('Не удалось удалить профиль. Проверьте соединение и попробуйте снова.'); }
    finally { setDataBusy(false); }
  };

  const pay = async (plan: string) => {
    if (!profileId || billingBusy) return;
    setBillingBusy(true); setBillingError('');
    try {
      const res = await apiFetch('/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, plan }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.checkoutUrl !== 'string') throw new Error('payment_failed');
      window.location.assign(data.checkoutUrl);
    } catch { setBillingError('Не удалось открыть оплату. Попробуйте позже; доступ появится только после подтверждения платежа.'); }
    finally { setBillingBusy(false); }
  };

  if (loadingState === 'loading') return <div className="wrap"><div className="card" role="status">Загружаем кабинет…</div></div>;
  if (loadingState === 'error') return <div className="wrap"><div className="card"><h1>Кабинет родителя</h1><p role="alert">Не удалось загрузить данные. Откройте приложение через Telegram или MAX и проверьте соединение.</p><button className="btn secondary" onClick={() => window.location.reload()}>Попробовать снова</button></div></div>;
  if (!profileId || loadingState === 'no-profile')
    return (
      <div className="wrap">
        <div className="card">
          <h1>Кабинет родителя</h1>
          <p className="muted">Откройте ссылку из бота или пройдите онбординг в тренажёре.</p>
        </div>
      </div>
    );

  const pct = program
    ? Math.round((program.progress.completedDays / program.progress.totalDays) * 100)
    : 0;

  return (
    <div className="wrap">
      <div className="card hero-card">
        <img src="/art/mascot-think.png" alt="" className="mascot" />
        <div className="hero-text">
          <span className="tag">Отчёт для родителя</span>
          <h1>{profile?.name ?? 'Ребёнок'}</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            {profile?.age} лет · линейка {profile?.band} · {TIME_ZONES.find(z => z.id === profileZone(profile?.timeZone))?.label}
          </p>
        </div>
      </div>

      {children.length > 1 && (
        <div className="card">
          <h2>Дети в семье</h2>
          <p className="muted small">Отчёт, карта и семейные идеи открываются для выбранного ребёнка. Общая цель семьи считает всех вместе.</p>
          <div className="child-switch" role="group" aria-label="Выбрать ребёнка">
            {children.map(child => (
              <button
                key={child.id}
                type="button"
                className={`chip child-chip${child.id === profileId ? ' on' : ''}`}
                aria-pressed={child.id === profileId}
                onClick={() => window.location.assign(`/parent?profileId=${encodeURIComponent(child.id)}`)}
              >
                {child.name}, {child.age}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- прогресс программы ---------------- */}
      {program && (
        <div className="card">
          <h2>Программа: 12 недель</h2>
          <div className="stat">
            <span>Пройдено дней</span>
            <b>
              {program.progress.completedDays} из {program.progress.totalDays}
            </b>
          </div>
          <div className="stat">
            <span>Текущая неделя</span>
            <b>
              {program.progress.currentWeek} из 12
              {program.progress.finished ? ' — программа пройдена' : ''}
            </b>
          </div>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Каждый день программы открывается после предыдущего. Пропущенный день можно
            повторить — кнопка «Повторить предыдущий день» в тренажёре.
          </p>
          <div className="review-toggle">
            <label htmlFor="review-switch">Предлагать повторение тем</label>
            <input
              id="review-switch"
              type="checkbox"
              checked={!program.reviewOff}
              disabled={reviewBusy}
              onChange={e => void toggleReview(!e.target.checked)}
            />
            <p className="muted small">
              Повтор предлагается по расписанию и никогда не блокирует новый день.
              Если выключить, предложения пропадут, а прогресс и сроки останутся.
              Это решение взрослого, а не оценка ребёнка.
            </p>
            {reviewMessage && <p role="status" className="muted small">{reviewMessage}</p>}
          </div>
        </div>
      )}

      <PracticeMap profileId={profileId} />
      <FamilyGoal profileId={profileId} />
      <FamilyIdeas profileId={profileId} parentView />
      <FeelingsConsent profileId={profileId} />
      <ParentPinSettings />

      {/* ---------------- недели программы ---------------- */}
      {program && (
        <div className="card">
          <h2>План недель</h2>
          {program.weeks.map((w) => (
            <div className="week-block" key={w.week}>
              <button className="week-head" type="button" aria-expanded={openWeek === w.week} aria-controls={`week-body-${w.week}`} onClick={() => setOpenWeek(openWeek === w.week ? null : w.week)}>
                <span className="week-art" style={{ backgroundImage: `url("${w.art}"), url("${DEFAULT_ART}")` }}>
                  <span className="week-num">{w.week}</span>
                </span>
                <span
                  className="comp-icon"
                  style={{ backgroundImage: `url("${competencyArt(w.competency)}"), url("${DEFAULT_ART}")` }}
                  title={COMPETENCY_LABEL[w.competency]}
                />
                <span className="week-title">
                  <b>
                    Неделя {w.week}. {w.title}
                  </b>
                  <span className="muted">
                    {COMPETENCY_LABEL[w.competency] ?? w.competency} ·{' '}
                    {w.days.filter((d) => d.done).length}/5 дней
                  </span>
                </span>
                <span className="week-caret">{openWeek === w.week ? '−' : '+'}</span>
              </button>
              <div className="week-body" id={`week-body-${w.week}`} hidden={openWeek !== w.week}>
                  {openWeek === w.week && <img className="week-full-art" src={w.art} alt="" loading="lazy" decoding="async" onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_ART)) e.currentTarget.src = DEFAULT_ART; }} />}
                  <p className="muted">{w.subtitle}</p>
                  {w.days.map((d) => (
                    <div className={`plan${d.current ? ' current' : ''}`} key={d.day}>
                      <span className="badge">{d.done ? '✓' : d.current ? '▶' : d.day}</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          День {d.day}. {d.theme}
                        </div>
                        <div className="muted">{d.title}</div>
                        <div className="muted">Что заметить: {d.parentGoal}</div>
                      </div>
                    </div>
                  ))}
                  <hr />
                  <p>
                    <b>Цель недели для вас:</b> {w.parentNote}
                  </p>
                  <p>
                    <b>Дома:</b>
                  </p>
                  <ul>
                    {w.homeIdeas.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                  <p>
                    <b>Вопрос по итогам недели:</b> {w.weekQuestion}
                  </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- игровой прогресс ---------------- */}
      {report?.player && (
        <div className="card">
          <h2>Игра и прогресс</h2>
          <div className="row">
            <div className="stat">
              <span>Уровень</span>
              <b>
                {report.player.level} · {report.player.levelTitle}
              </b>
            </div>
            <div className="stat">
              <span>Опыт</span>
              <b>{report.player.xp} XP</b>
            </div>
            <div className="stat">
              <span>Звёзды</span>
              <b>{report.player.stars}</b>
            </div>
            <div className="stat">
              <span>Завершённых занятий</span>
              <b>{report.player.days}</b>
            </div>
            <div className="stat">
              <span>Значков</span>
              <b>{report.player.badges}</b>
            </div>
            <div className="stat">
              <span>Идеальных дней</span>
              <b>{report.player.perfectDays}</b>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Внутри тренажёра ребёнок копит опыт, монетки и значки, а гардероб и питомца
            открывает за игровую валюту — реальных платежей детям нет.
          </p>
        </div>
      )}

      {/* -------- отчёт по журналу событий: только завершённые занятия -------- */}
      {eventsReport && (
        <div className="card">
          <h2>Из журнала занятий</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Считается только по завершённым занятиям за последние 7 дней. Незаконченная тренировка сюда не попадает.
          </p>
          <div className="stat"><span>Завершённых занятий</span><b>{eventsReport.student.sessions}</b></div>
          <div className="stat"><span>Минут от начала до конца</span><b>{eventsReport.student.minutes}</b></div>
          <div className="stat"><span>Ответов на задания</span><b>{eventsReport.student.tasks}</b></div>
          <div className="stat"><span>Историй разобрано</span><b>{eventsReport.student.stories}</b></div>
          <div className="stat"><span>Игр с идеями поддержки (пропущено: {eventsReport.student.skippedPractices})</span><b>{eventsReport.student.practices}</b></div>
          <div className="stat"><span>Заданий с подсказкой или повтором (не влияют на точность)</span><b>{eventsReport.student.excludedTasks}</b></div>
          {eventsReport.student.sessions === 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>Завершённых занятий на этой неделе пока нет — отчёт пуст, и это нормально.</p>
          )}
          {eventsReport.student.sessions > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>Откуда эти числа</summary>
              <ul className="muted">
                {eventsReport.sources.map(source => (
                  <li key={source.event}>{source.event} (v{source.version}): {source.records} записей</li>
                ))}
                {eventsReport.skills.filter(skill => skill.tasks > 0).map(skill => (
                  <li key={skill.skill}>
                    {skill.skill}: {Math.round((skill.accuracy ?? 0) * 100)}% верных из {skill.tasks} заданий
                    {skill.excluded ? `, ${skill.excluded} с подсказкой не учитывались` : ''}
                  </li>
                ))}
              </ul>
              <ul className="muted">
                {eventsReport.limits.map(limit => <li key={limit}>{limit}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ---------------- недельный отчёт ---------------- */}
      {report && (
        <>
          <div className="card">
            <h2>Неделя</h2>
            <div className="stat">
              <span>Минут от начала до конца (включая перерывы)</span>
              <b>{report.minutes}</b>
            </div>
            <div className="stat">
              <span>Тренировок</span>
              <b>{report.sessions}</b>
            </div>
            <div className="stat">
              <span>Заданий решено</span>
              <b>{report.tasksDone}</b>
            </div>
            <div className="stat">
              <span>Ситуаций разобрано</span>
              <b>{report.scenariosDone}</b>
            </div>
            <div className="stat"><span>Игр с идеями поддержки</span><b>{report.supportPracticesDone ?? 0}</b></div>
          </div>

          <div className="card">
            <h2>Карта навыков</h2>
            <SkillRadar skills={report.skills} />
          </div>

          <div className="card">
            <h2>Навыки</h2>
            {report.skills.map((s) => (
              <div className="stat" key={s.skill}>
                <span>
                  <img src={skillArt(s.skill)} alt="" className="skill-icon small" onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_ART)) e.currentTarget.src = DEFAULT_ART; }} /> {s.label}
                </span>
                <span className={`delta ${(s.delta ?? 0) > 0 ? 'up' : (s.delta ?? 0) < 0 ? 'down' : 'flat'}`}>
                  {s.delta === null ? 'нет данных' : s.delta > 0 ? `+${s.delta} п.п.` : `${s.delta} п.п.`}
                </span>
              </div>
            ))}
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Разница в процентных пунктах: доля верных ответов на этой неделе минус доля за прошлую неделю. При отсутствии данных сравнения нет. Задания с повторным показом, восстановлением задания на память, текстовой подсказкой или счётными монетками не учитываются в изменении показателей и настройке сложности, но входят в число выполненных заданий. За неделю таких заданий: {report.assistedTasks ?? 0}. Это игровые показатели, не диагностика.
            </p>
          </div>

          <div className="card">
            <h2>Победа недели</h2>
            <p>{report.win}</p>
            <hr />
            <h2>Зона роста</h2>
            <p>{report.growth}</p>
            <hr />
            <h2>Задание на дом (10 минут)</h2>
            <p>{report.home}</p>
            <hr />
            <h2>Вопрос за ужином</h2>
            <p>{report.question}</p>
          </div>

          {report.scenarioNotes.length > 0 && (
            <div className="card">
              <h2>Что тренировали в мягких навыках</h2>
              {report.scenarioNotes.map((n) => (
                <div className="stat" key={n.scenarioId + n.text}>
                  <span>{n.text}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="card">
        <h2>Подписка</h2>
        {sub?.status === 'active' ? (
          <p>
            Активна: <b>{PLAN_TITLES[sub.plan]}</b> до {new Date(sub.until).toLocaleDateString('ru-RU')}. Спасибо!
          </p>
        ) : (
          <>
            <p className="muted">
              Доступ на 30 дней. Автоматического списания нет. Оплата доступна только родителю.
            </p>
            {!billingAvailable && <p className="muted">Платёжный сервис пока не настроен.</p>}
            {billingError && <p role="alert">{billingError}</p>}
            {Object.entries(plans).map(([key, p]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <div className="price">
                  {p.price.toLocaleString('ru-RU')} ₽
                  <span style={{ fontSize: 15, fontWeight: 600 }}> / {key === 'month' ? 'мес' : 'год'}</span>
                </div>
                <div className="muted" style={{ marginBottom: 8 }}>
                  {p.title}: {p.perks.join(' · ')}
                </div>
                <button className="btn" disabled={!billingAvailable || billingBusy} onClick={() => pay(key)}>
                  Перейти к оплате
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>Данные профиля</h2>
        <label htmlFor="parent-zone">Часовой пояс</label>
        <select id="parent-zone" value={selectedZone} disabled={dataBusy} onChange={e => setSelectedZone(e.target.value)}>
          {TIME_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
        </select>
        <button type="button" className="btn secondary" disabled={dataBusy || selectedZone === profileZone(profile?.timeZone)} onClick={saveZone}>Сохранить часовой пояс</button>
        <p className="muted">Недельный отчёт пересчитается по выбранному часовому поясу.</p>
        {zoneMessage && <p role="status">{zoneMessage}</p>}
        {dataError && <p role="alert">{dataError}</p>}
      </div>

      <NotificationSettings profileId={profileId} />
      <DataControls profileId={profileId} busy={dataBusy} onExport={exportProfile} onDelete={deleteProfile} />

      <p className="muted">Открытые компоненты: <a href="/licenses/xstate-mit.txt">XState — MIT</a>, <a href="/licenses/simple-qbn-mit.txt">SimpleQBN — MIT</a> (зависимости: <a href="/licenses/mingo-mit.txt">Mingo — MIT</a>, <a href="/licenses/uuid-mit.txt">uuid — MIT</a>), <a href="/licenses/ts-fsrs-mit.txt">ts-fsrs — MIT</a>, <a href="/licenses/pocketbase-js-mit.txt">PocketBase SDK — MIT</a>, <a href="/licenses/phaser.txt">Phaser — MIT</a>, <a href="/licenses/inkjs.txt">inkjs — MIT</a>, <a href="/licenses/blockly.txt">Blockly — Apache-2.0</a>, <a href="/licenses/opendyslexic-ofl.txt">OpenDyslexic — SIL OFL 1.1</a>; значки <a href="https://openmoji.org/">OpenMoji</a> — <a href="/licenses/openmoji-cc-by-sa-4.0.txt">CC BY-SA 4.0</a>, без изменений; Tilli Godot: <a href="/licenses/tilli-godot-license.txt">LICENSE</a> и <a href="/licenses/tilli-godot-license-md.txt">LICENSE.md</a>.</p>

      <Link className="btn secondary" href="/">
        К тренажёру
      </Link>
    </div>
  );
}


/** Радар навыков ребёнка — наглядно для родителя. */
function SkillRadar({ skills }: { skills: { label: string; ability: number }[] }) {
  const size = 300;
  const c = size / 2;
  const r = 110;
  const n = Math.max(skills.length, 3);
  const point = (i: number, ratio: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + Math.cos(a) * r * ratio, c + Math.sin(a) * r * ratio] as const;
  };
  const rings = [0.25, 0.5, 0.75, 1];
  const poly = skills
    .map((s, i) => point(i, Math.max(0.08, Math.min(1, s.ability))).join(','))
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar">
      {rings.map((rr) => (
        <polygon
          key={rr}
          points={skills.map((_, i) => point(i, rr).join(',')).join(' ')}
          fill="none"
          stroke="#d8d8e6"
          strokeWidth="1.5"
        />
      ))}
      {skills.map((_, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.22);
        return (
          <g key={i}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="#d8d8e6" strokeWidth="1.5" />
            <text x={lx} y={ly} textAnchor="middle" fontSize="11" fontWeight="700" fill="#3a3a55">
              {skills[i]?.label}
            </text>
          </g>
        );
      })}
      <polygon points={poly} fill="rgba(62,201,167,.45)" stroke="#1b1b2f" strokeWidth="2.5" />
      {skills.map((s, i) => {
        const [x, y] = point(i, Math.max(0.08, Math.min(1, s.ability)));
        return <circle key={i} cx={x} cy={y} r="4.5" fill="#3ec9a7" stroke="#1b1b2f" strokeWidth="2" />;
      })}
    </svg>
  );
}
