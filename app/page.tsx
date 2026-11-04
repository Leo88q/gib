'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { skillArt, DEFAULT_ART } from '@/lib/art-paths';
import type { AgeBand } from '@/lib/types';
import TaskView, { type AnswerPayload, type TaskInstance } from '@/components/TaskView';
import ScenarioView from '@/components/ScenarioView';
import ReadAloud from '@/components/ReadAloud';
import SupportPractice from '@/components/SupportPractice';
import Hud, { type HudData } from '@/components/Hud';
import Missions, { type MissionView } from '@/components/Missions';
import BadgeGrid, { type BadgeView } from '@/components/BadgeGrid';
import Shop, { type ShopItemView } from '@/components/Shop';
import Rewards from '@/components/Rewards';
import DayWelcome from '@/components/DayWelcome';
import DayReflection from '@/components/DayReflection';
import PracticeMap from '@/components/PracticeMap';
import FamilyIdeas from '@/components/FamilyIdeas';
import Room from '@/components/Room';
import { sfx } from '@/lib/sound';
import { accessoryVariantOf, bodyVariantOf, petVariantOf } from '@/lib/gamification';
import { petMood, petMoodText } from '@/lib/pet-mood';
import { TIME_ZONES, DEFAULT_TIME_ZONE } from '@/lib/calendar';
import { switchDraftKey } from '@/lib/switch-draft';
import { selectionDraftKey } from '@/lib/selection-draft';
import { exerciseDraftKey, removeProfileExerciseDrafts } from '@/lib/exercise-draft';
import { PENDING_ANSWER_KEY, parsePendingAnswer, clearMatchingPendingAnswer, type PendingAnswer } from '@/lib/pending-answer';
import { hideBackButton, apiFetch, setupTelegram, showBackButton, haptic } from '@/lib/telegramClient';

type StoryCardView = { id: string; title: string };

type Profile = { id: string; name: string; age: number; band: AgeBand };

type PlanRow = { type: 'task' | 'scenario'; title: string; skill: string; skillId: string };

type ProgramInfo = {
  week: number;
  weekTitle: string;
  weekArt: string;
  weekSubtitle: string;
  day: number;
  dayTheme: string;
  parentGoal: string;
  completedDays: number;
  totalDays: number;
  finished: boolean;
  /** Тема, которую сервер предлагает повторить (или null). */
  review?: { topicId: string; title: string } | null;
  /** Когда завершилось последнее занятие — для настроения питомца. */
  lastFinishedAt?: number | null;
};

type PlayerInfo = {
  xp: number;
  coins: number;
  stars: number;
  level: number;
  levelTitle: string;
  xpPercent: number;
  badges: string[];
  inventory: string[];
  equipped: { head: string | null; body: string | null; pet: string | null; room: string | null };
};

type Item =
  | { type: 'task'; instance: TaskInstance; quest?: string; boss?: boolean }
  | {
      type: 'scenario';
      scenarioId: string;
      competency: string;
      skillLabel: string;
      quest?: string;
      variant: { title: string; text: string; options: { text: string }[]; followUps?: { text: string; choices: string[] }[] };
    };

type Feedback = {
  correct: boolean;
  skipped?: boolean;
  text: string;
  goodNote?: string;
  done: boolean;
  xp: number;
  coins: number;
  combo: number;
  newBadges: string[];
  levelUp: { level: number; title: string } | null;
};

type Summary = {
  tasks: number;
  correct: number;
  stars: number;
  comboBest: number;
};

export default function Home() {
  const [stage, setStage] = useState<'boot' | 'onboarding' | 'home' | 'welcome' | 'training' | 'done' | 'reflection'>('boot');
  const [tab, setTab] = useState<'home' | 'map' | 'family' | 'badges' | 'shop'>('home');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [children, setChildren] = useState<{ id: string; name: string; age: number; band: string }[]>([]);
  const [addingChild, setAddingChild] = useState(false);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [program, setProgram] = useState<ProgramInfo | null>(null);
  const [player, setPlayer] = useState<PlayerInfo | null>(null);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [shop, setShop] = useState<ShopItemView[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [nextItem, setNextItem] = useState<Item | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastReward, setLastReward] = useState<Feedback | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [steps, setSteps] = useState(0);
  const [step, setStep] = useState(0);
  const [combo, setCombo] = useState(0);
  const [storyOffer, setStoryOffer] = useState<StoryCardView[]>([]);
  const [pendingStory, setPendingStory] = useState<string | null>(null);
  const [storySending, setStorySending] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [missionNotice, setMissionNotice] = useState('');
  const busy = useRef(false);
  const playerBusy = useRef(false);
  const [answerSending, setAnswerSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [repeatDay, setRepeatDay] = useState(false);
  /** Заголовок темы, которую сейчас повторяем (только внутри захода). */
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [resumedPractice, setResumedPractice] = useState(false);
  const pendingAnswer = useRef<PendingAnswer<Item> | null>(null);
  // Keep the last acknowledged answer until its feedback (or final summary) is dismissed.
  const acknowledgedAnswer = useRef<PendingAnswer<Item> | null>(null);

  const clearAcknowledged = () => {
    const saved = acknowledgedAnswer.current;
    acknowledgedAnswer.current = null;
    if (!saved) return;
    try { clearMatchingPendingAnswer(sessionStorage, saved); } catch { /* storage may be disabled */ }
  };

  const loadPlayer = useCallback(async (profileId: string) => {
    try {
    const res = await apiFetch(`/api/player?profileId=${encodeURIComponent(profileId)}`);
    if (!res.ok) throw new Error('player_failed');
    const data = await res.json();
    setPlayer(data.player ?? null);
    setMissions(data.missions ?? []);
    setBadges(data.badges ?? []);
    setShop(data.shop ?? []);
    } catch { setRequestError('Не удалось обновить игровой прогресс. Проверьте соединение.'); }
  }, []);

  const loadPlan = useCallback(
    async (profileId: string) => {
      try {
      const res = await apiFetch(`/api/session?profileId=${encodeURIComponent(profileId)}`);
      if (!res.ok) throw new Error('plan_failed');
      const data = await res.json();
      setPlan(data.plan ?? []);
      setProgram(data.program ?? null);
      } catch { setRequestError('Не удалось обновить план миссии. Проверьте соединение.'); }
    },
    [],
  );

  useEffect(() => {
    setupTelegram();
  }, []);

  useEffect(() => {
    if (stage === 'welcome' || stage === 'reflection') {
      if (starting) { hideBackButton(); return; }
      showBackButton(() => { setRequestError(''); setStage('home'); });
      return () => hideBackButton();
    }
    if (stage !== 'training') {
      hideBackButton();
      return;
    }
    if (answerSending || (requestError && pendingAnswer.current)) { hideBackButton(); return; }
    showBackButton(() => {
      if (feedback) advance();
      else setStage('home');
    });
    return () => hideBackButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, feedback, answerSending, requestError, starting]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data;
      try {
        // Выбранный ребёнок хранится в браузере; сервер проверяет владение сам.
        let wanted = '';
        try { wanted = localStorage.getItem('gib:profileId') ?? ''; } catch { /* storage is optional */ }
        const res = await apiFetch(`/api/profile${wanted ? `?profileId=${encodeURIComponent(wanted)}` : ''}`);
        if (!res.ok) throw new Error('profile');
        data = await res.json();
      } catch {
        if (!cancelled) setRequestError('Не удалось загрузить профиль. Проверьте соединение и перезапустите приложение.');
        return;
      }
      if (cancelled) return;
      if (Array.isArray(data.profiles)) setChildren(data.profiles);
      if (data.profile) {
        setProfile(data.profile);
        try { localStorage.setItem('gib:profileId', data.profile.id); } catch { /* optional convenience only */ }
        setStage('home');
        void loadPlan(data.profile.id);
        void loadPlayer(data.profile.id);
      } else {
        setStage('onboarding');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createProfile = async (name: string, age: number, timeZone: string) => {
    const res = await apiFetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, age, timeZone, ...(addingChild ? { addChild: true } : {}) }),
    });
    if (!res.ok) throw new Error('profile_failed');
    const data = await res.json();
    if (!data.profile?.id) throw new Error('profile_failed');
    setProfile(data.profile);
    setChildren(prev => {
      const others = prev.filter(c => c.id !== data.profile.id);
      return [...others, { id: data.profile.id, name: data.profile.name, age: data.profile.age, band: data.profile.band }];
    });
    setAddingChild(false);
    try { localStorage.setItem('gib:profileId', data.profile.id); } catch { /* optional convenience only */ }
    setStage('home');
    void loadPlan(data.profile.id);
    void loadPlayer(data.profile.id);
  };

  /**
   * Переключение между детьми одной семьи.
   * Выбор живёт только в этом браузере: сервер не смешивает данные профилей,
   * а семейная цель считает их общий вклад.
   */
  const switchChild = (id: string) => {
    const next = children.find(c => c.id === id);
    if (!next || next.id === profile?.id) return;
    setRequestError('');
    setProgram(null); setPlayer(null);
    try { localStorage.setItem('gib:profileId', next.id); } catch { /* optional convenience only */ }
    // Данные профиля приходят с сервера: локальных копий прогресса нет.
    window.location.assign(`/?profileId=${encodeURIComponent(next.id)}`);
  };

  /** Повтор темы: отдельный заход, только когда сервер говорит, что тема пришла в срок. */
  const startReview = async () => {
    if (!profile || busy.current) return;
    busy.current = true; setStarting(true); setRequestError('');
    try {
      const res = await apiFetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', profileId: profile.id, review: true, storyChoice: true, journey: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.sessionId) throw new Error('start_failed');
      if (!data.review) { setRequestError('Повтор пока недоступен — можно начать миссию дня.'); return; }
      setRepeatDay(false);
      setFeedback(null); setNextItem(null);
      setSessionId(data.sessionId); setStoryOffer([]); setPendingStory(null);
      setResumedPractice(false);
      setItem(data.item); setSteps(data.steps ?? 1); setStep(data.step ?? 0); setCombo(0);
      setReviewNotice(data.review.title);
      setStage('training');
    } catch { setRequestError('Не удалось открыть повтор. Проверьте соединение.'); }
    finally { busy.current = false; setStarting(false); }
  };

  const start = async (repeat = false) => {
    if (!profile || busy.current) return;
    let recovered: PendingAnswer<Item> | null = pendingAnswer.current?.profileId === profile.id ? pendingAnswer.current : null;
    try { recovered ??= parsePendingAnswer<Item>(sessionStorage.getItem(PENDING_ANSWER_KEY), profile.id); } catch { /* storage may be disabled */ }
    if (recovered) {
      setFeedback(null);
      setNextItem(null);
      setStoryOffer([]); setPendingStory(null);
      setSessionId(recovered.sessionId);
      setItem(recovered.item);
      setSteps(recovered.steps);
      setStep(recovered.step);
      setStage('training');
      void answer(recovered.payload, recovered.ms, recovered).catch(() => {});
      return;
    }
    sfx.tap();
    setCombo(0);
    setStep(0);
    setReviewNotice(null);
    if (busy.current) return;
    busy.current = true;
    setStarting(true);
    setRequestError('');
    try {
    const res = await apiFetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', profileId: profile.id, repeat, storyChoice: true, journey: true }),
    });
    const data = await res.json();
    if (!res.ok || !data.sessionId) throw new Error('start_failed');
    setFeedback(null);
    const auto = data.autoClaimed;
    setMissionNotice(auto?.count ? `Награды за прошлые миссии получены: +${auto.xp} XP, +${auto.coins} монет.` : '');
    if (auto?.count) void loadPlayer(profile.id);
    setNextItem(null);
    setSessionId(data.sessionId);
    const offered = Array.isArray(data.storyOffer) && !data.storySelected ? data.storyOffer as StoryCardView[] : [];
    setStoryOffer(offered); setPendingStory(null);
    setResumedPractice(Boolean(data.resumed && data.item?.type === 'task' && !offered.length));
    setItem(data.item);
    setSteps(data.steps ?? 4);
    setStep(data.step ?? 0);
    setCombo(data.combo ?? 0);
    setStage('training');
    } catch { setRequestError('Не удалось открыть миссию. Проверьте связь и попробуйте ещё раз.'); }
    finally { busy.current = false; setStarting(false); }
  };

  const chooseStory = async (cardId: string) => {
    if (!sessionId || storySending || (pendingStory && pendingStory !== cardId)) return;
    setPendingStory(cardId); setStorySending(true); setRequestError('');
    try {
      const res = await apiFetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'select_story', sessionId, cardId }) });
      const result = await res.json();
      if (!res.ok || result.cardId !== cardId) throw new Error('selection_failed');
      if (result.finished) { setStoryOffer([]); setPendingStory(null); setReviewNotice(null); setStage('home'); if (profile) { void loadPlan(profile.id); void loadPlayer(profile.id); } return; }
      if (result.item) { setItem(result.item); if (Number.isInteger(result.step)) setStep(result.step); if (Number.isInteger(result.steps)) setSteps(result.steps); }
      setStoryOffer([]); setPendingStory(null);
    } catch { setRequestError('Не удалось подтвердить выбор. Повтори отправку или открой миссию заново.'); }
    finally { setStorySending(false); }
  };

  const answer = async (payload: AnswerPayload, ms: number, recovered?: PendingAnswer<Item>) => {
    const pending = recovered ?? (sessionId && item && profile ? { profileId: profile.id, sessionId, step, steps, item, payload, ms } : null);
    if (!pending || busy.current) return;
    busy.current = true;
    pendingAnswer.current = pending;
    // Только на время восстановления в текущей вкладке; токены и initData не сохраняем.
    try { sessionStorage.setItem(PENDING_ANSWER_KEY, JSON.stringify(pending)); } catch { /* retry still works in memory */ }
    setAnswerSending(true);
    setRequestError('');
    try {
    const res = await apiFetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'answer', sessionId: pending.sessionId, answer: pending.payload, ms: pending.ms, step: pending.step }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(res.status === 409 ? 'step_conflict' : data.error || 'answer_failed');
    pendingAnswer.current = null;
    acknowledgedAnswer.current = pending;
    // Retain the answer for replay after a reload until the child dismisses the result.
    try { sessionStorage.removeItem(switchDraftKey(pending.profileId, pending.sessionId, pending.step)); sessionStorage.removeItem(selectionDraftKey(pending.profileId, pending.sessionId, pending.step)); sessionStorage.removeItem(exerciseDraftKey(pending.profileId, pending.sessionId, pending.step, 'single')); sessionStorage.removeItem(exerciseDraftKey(pending.profileId, pending.sessionId, pending.step, 'digits')); } catch { /* storage may be disabled */ }
    const reward = data.reward ?? {};
    if (pending.item.type === 'scenario' || (pending.item.type === 'task' && pending.item.instance.kind === 'social-practice')) {
      // A story choice is not an incorrect cognitive answer.
      haptic('light');
    } else if (data.correct) {
      haptic('success');
      if ((reward.combo ?? 0) > 1) sfx.combo(reward.combo);
      else sfx.correct();
    } else {
      haptic('error');
      sfx.wrong();
    }
    if (reward.coins) sfx.coin();
    setCombo(reward.combo ?? 0);
    setFeedback({
      correct: data.correct,
      skipped: pending.payload.skip === true,
      text: data.feedback,
      goodNote: data.goodNote,
      done: data.done,
      xp: reward.xp ?? 0,
      coins: reward.coins ?? 0,
      combo: reward.combo ?? 0,
      newBadges: reward.newBadges ?? [],
      levelUp: reward.levelUp ?? null,
    });
    setNextItem(data.next);
    if (data.done) {
      setSummary(data.summary);
      setLastReward({
        correct: data.correct,
        text: data.feedback,
        done: true,
        xp: reward.xp ?? 0,
        coins: reward.coins ?? 0,
        combo: reward.combo ?? 0,
        newBadges: reward.newBadges ?? [],
        levelUp: reward.levelUp ?? null,
      });
      sfx.finish();
      if (reward.levelUp) sfx.levelUp();
      if ((reward.newBadges ?? []).length) sfx.badge();
      void loadPlayer(profile!.id);
    }
    } catch (error) {
      setRequestError(error instanceof Error && error.message === 'step_conflict' ? 'Этот шаг уже изменился. Выйдите домой и откройте миссию снова.' : 'Не удалось получить результат. Повторите отправку: награда не начислится дважды.');
      throw error;
    } finally { busy.current = false; setAnswerSending(false); }
  };

  const advance = async () => {
    const done = feedback?.done;
    setFeedback(null);
    if (done) {
      setStage('done');
      if (profile) {
        void loadPlan(profile.id);
        void loadPlayer(profile.id);
      }
      return;
    }
    if (nextItem) {
      clearAcknowledged();
      setItem(nextItem);
      setResumedPractice(false);
      setNextItem(null);
      setStep((s) => s + 1);
    }
  };

  const playerAction = async (action: 'claim' | 'buy' | 'equip', id: string) => {
    if (!profile || playerBusy.current) return;
    playerBusy.current = true;
    setRequestError('');
    try {
      const res = await apiFetch('/api/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id, action, id }),
      });
      if (!res.ok) throw new Error('player_action_failed');
      if (action === 'equip') sfx.tap(); else sfx.coin();
      await loadPlayer(profile.id);
    } catch {
      setRequestError('Не удалось подтвердить действие. Проверяем сохранённый прогресс.');
      await loadPlayer(profile.id);
    } finally { playerBusy.current = false; }
  };
  const claimMission = (id: string) => playerAction('claim', id);
  const buyItem = (id: string) => playerAction('buy', id);
  const equipItem = (id: string) => playerAction('equip', id);

  const hud: HudData = useMemo(
    () => ({
      level: player?.level ?? 1,
      levelTitle: player?.levelTitle ?? 'Новичок',
      xp: player?.xp ?? 0,
      xpPercent: player?.xpPercent ?? 0,
      coins: player?.coins ?? 0,
      stars: player?.stars ?? 0,
      combo,
    }),
    [player, combo],
  );

  /* ------------------------------ рендер ------------------------------ */

  if (stage === 'boot')
    return (
      <div className="wrap">
        <div className="panel center">{requestError || 'Загрузка…'}</div>
      </div>
    );

  if (stage === 'onboarding') return <Onboarding onDone={createProfile} onCancel={children.length > 0 ? () => setAddingChild(false) : undefined} />;

  if (stage === 'home')
    return (
      <div className="wrap">
        <Hud data={hud} />
        {requestError && <p className="request-error" role="alert">{requestError}</p>}

        {/* Несколько детей в одной семье: переключатель виден только когда их больше одного. */}
        {children.length > 1 && (
          <div className="child-switch" role="group" aria-label="Выбрать ребёнка">
            <span className="muted small">Занимается:</span>
            {children.map(child => (
              <button
                key={child.id}
                type="button"
                className={`chip child-chip${child.id === profile?.id ? ' on' : ''}`}
                aria-pressed={child.id === profile?.id}
                onClick={() => switchChild(child.id)}
              >
                {child.name}, {child.age}
              </button>
            ))}
          </div>
        )}

        <Room
          avatar={{
            accessory: accessoryVariantOf(player?.equipped.head ?? null),
            body: bodyVariantOf(player?.equipped.body ?? null),
          }}
          pet={petVariantOf(player?.equipped.pet ?? null)}
          petLevel={player?.level ?? 1}
          decor={{
            rug: player?.equipped.room === 'room_rug',
            lamp: player?.equipped.room === 'room_lamp',
            poster: player?.equipped.room === 'room_poster',
            plant: player?.equipped.room === 'room_plant',
          }}
          bubble={greeting(program, player)}
          petMood={moodFor(program)}
        />
        {player?.equipped.pet && (
          <p className="pet-mood-note muted small">{petMoodText(moodFor(program))}</p>
        )}

        <nav className="tabs">
          <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>
            🏠 Дом
          </button>
          <button className={tab === 'family' ? 'on' : ''} onClick={() => setTab('family')}>🌱 Семья</button>
          <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>🗺️ Карта</button>
          <button className={tab === 'badges' ? 'on' : ''} onClick={() => setTab('badges')}>
            🏅 Значки
          </button>
          <button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>
            👕 Гардероб
          </button>
          <Link href={`/parent?profileId=${profile?.id}`}>👨‍👩‍👧 Родителю</Link>
          <button
            type="button"
            className="chip add-child"
            onClick={() => { setAddingChild(true); setStage('onboarding'); }}
          >
            ➕ Ещё ребёнок
          </button>
        </nav>

        {tab === 'home' && (
          <>
            <div className="panel mission-card">
              {program?.weekArt && <img className="mission-week-art" src={program.weekArt} alt="" decoding="async" onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_ART)) e.currentTarget.src = DEFAULT_ART; }} />}
              <div className="mission-card-head">
                <span className="chip">
                  Неделя {program?.week ?? 1} · день {program?.day ?? 1}
                </span>
                <span className="chip">{program?.weekTitle ?? 'Программа'}</span>
              </div>
              <h2>{program?.dayTheme ?? 'Тренировка дня'}</h2>
              <p className="muted">{program?.weekSubtitle ?? ''}</p>
              <p className="muted">Что входит в миссию (порядок может отличаться при продолжении):</p>
              <div className="plan-chips">
                {plan.map((p, i) => (
                  <span key={i} className="chip">
                    <img
                      src={skillArt(p.skillId)}
                      onError={e => { if (!e.currentTarget.src.endsWith(DEFAULT_ART)) e.currentTarget.src = DEFAULT_ART; }}
                      alt=""
                    />
                    {p.title}
                  </span>
                ))}
              </div>
              <p className="muted">В новых миссиях после истории есть необязательная мастерская идей.</p>
              <div className="week-dots">
                {[1, 2, 3, 4, 5].map((d) => (
                  <span
                    key={d}
                    className={
                      d < (program?.day ?? 1)
                        ? 'dot done'
                        : d === (program?.day ?? 1)
                          ? 'dot now'
                          : 'dot'
                    }
                  />
                ))}
              </div>
              <button type="button" className="btn big" onClick={() => { setRepeatDay(false); setRequestError(''); setStage('welcome'); }}>
                {program?.finished ? 'Ещё раз!' : '▶ Начать миссию'}
              </button>
              {(program?.completedDays ?? 0) > 0 && (
                <button type="button" className="btn ghost" onClick={() => { setRepeatDay(true); setRequestError(''); setStage('welcome'); }}>
                  ↺ Повторить прошлый день
                </button>
              )}
              {(program?.review ?? null) && (
                <button type="button" className="btn ghost" onClick={() => { void startReview(); }}>
                  🔁 Вернуться к теме «{program!.review!.title}» — по желанию
                </button>
              )}
            </div>

            <Missions missions={missions} onClaim={claimMission} />
          </>
        )}

        {tab === 'family' && profile && <FamilyIdeas profileId={profile.id} />}

        {tab === 'map' && profile && <PracticeMap profileId={profile.id} />}

        {tab === 'badges' && <BadgeGrid badges={badges} />}

        {tab === 'shop' && (
          <Shop
            items={shop}
            coins={player?.coins ?? 0}
            inventory={player?.inventory ?? []}
            equipped={{
              head: player?.equipped.head ?? null,
              body: player?.equipped.body ?? null,
              pet: petVariantOf(player?.equipped.pet ?? null),
              room: player?.equipped.room ?? null,
            }}
            level={player?.level ?? 1}
            onBuy={buyItem}
            onEquip={equipItem}
          />
        )}
      </div>
    );

  if (stage === 'welcome' && profile) return <DayWelcome band={profile.band} starting={starting} error={requestError} profileId={profile.id} day={program?.completedDays ?? 0} onStart={() => { void start(repeatDay); }} onBack={() => { setRequestError(''); setStage('home'); }} />;
  if (stage === 'reflection') return <DayReflection profileId={profile?.id} day={program?.completedDays ?? 0} onDone={() => setStage('home')} />;

  if (stage === 'training' && storyOffer.length > 0)
    return <div className="wrap game">
      <Hud data={hud} compact />
      <div className="panel story-deck" aria-busy={storySending}>
        <div className="story-deck-heading"><img src="/art/mascot-think.png" alt="" width={64} height={64} /><div><span className="chip">История дня</span><h2>Какую историю откроем?</h2><p>Выбери одну карточку. Её можно будет продолжить после перерыва.</p></div></div>
        <div className="story-deck-cards">
          {storyOffer.map((card, index) => <button type="button" className="story-deck-card" key={card.id} disabled={storySending || Boolean(pendingStory && pendingStory !== card.id)} onClick={() => void chooseStory(card.id)}>
            <span className="story-deck-number">{index + 1}</span><strong>{card.title}</strong><span>{pendingStory === card.id ? 'Повторить выбор →' : 'Открыть →'}</span>
          </button>)}
        </div>
        {requestError && <div role="alert" className="request-error">{requestError} <button type="button" disabled={storySending} onClick={() => void start(false)}>Обновить миссию</button></div>}
        <button type="button" className="btn secondary" disabled={storySending} onClick={() => { setRequestError(''); setStage('home'); }}>Вернуться домой</button>
      </div>
    </div>;

  if (stage === 'training')
    return (
      <div className="wrap game">
        <Hud data={hud} compact />
        {requestError && <div className="request-error" role="alert">{requestError} {pendingAnswer.current && <button type="button" onClick={() => { const pending = pendingAnswer.current; if (pending) void answer(pending.payload, pending.ms, pending).catch(() => {}); }}>Повторить отправку</button>} <button type="button" onClick={() => { const pending = pendingAnswer.current; pendingAnswer.current = null; try { sessionStorage.removeItem(PENDING_ANSWER_KEY); if (pending) { sessionStorage.removeItem(switchDraftKey(pending.profileId, pending.sessionId, pending.step)); sessionStorage.removeItem(selectionDraftKey(pending.profileId, pending.sessionId, pending.step)); sessionStorage.removeItem(exerciseDraftKey(pending.profileId, pending.sessionId, pending.step, 'single')); sessionStorage.removeItem(exerciseDraftKey(pending.profileId, pending.sessionId, pending.step, 'digits')); } } catch {} setRequestError(''); setStage('home'); }}>{pendingAnswer.current ? 'Не восстанавливать и домой' : 'Домой'}</button></div>}

        {missionNotice && <p role="status" className="chip">{missionNotice}</p>}
        {/* Повтор: нейтральная подпись, без давления и без обещаний бонусов. */}
        {reviewNotice && (
          <p className="chip wrap-text">
            🔁 Повтор темы «{reviewNotice}». Можно пройти до конца или уйти домой — прогресс не потеряется.
          </p>
        )}
        <div className="step-bar" role="progressbar" aria-label="Прогресс миссии" aria-valuemin={0} aria-valuemax={steps} aria-valuenow={step} aria-valuetext={`Шаг ${step + 1} из ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={`step${i < step ? ' done' : ''}${i === step ? ' now' : ''}`} />
          ))}
        </div>

        {item?.type === 'task' && item.boss && (
          <div className="boss-banner">🛡️ Финальное задание недели</div>
        )}

        <div className="exercise-toolbar">
          <button type="button" className="exercise-pause" onClick={() => { setRequestError(''); setStage('home'); }}>
            ⏸ Пауза и домой
          </button>
          <details className="exercise-pause-help">
            <summary>Что будет с прогрессом?</summary>
            <p className="muted small">Прогресс и незавершённые отметки сохранятся. При возврате текущее задание засчитается как практика: награда за миссию не изменится.</p>
          </details>
        </div>

        {!(item?.type === 'task' && item.instance.kind !== 'social-practice') && (
          <div className="quest">
            <img src="/art/mascot-think.png" alt="" width={64} height={64} />
            <div className="quest-text">
              {item?.type === 'task' && item.quest}
              {item?.type === 'scenario' && item.quest}
            </div>
          </div>
        )}

        <div className="panel">
          <fieldset className="task-fieldset" disabled={answerSending || Boolean(feedback) || Boolean(requestError && pendingAnswer.current)} aria-busy={answerSending}>
          {item?.type === 'task' && item.instance.kind !== 'social-practice' && <TaskView key={`${sessionId}-${step}`} instance={item.instance} band={profile?.band ?? '8-10'} profileId={profile?.id} sessionId={sessionId ?? undefined} step={step} resumedPractice={resumedPractice} draftKey={profile && sessionId ? switchDraftKey(profile.id, sessionId, step) : undefined} selectionKey={profile && sessionId ? selectionDraftKey(profile.id, sessionId, step) : undefined} onAnswer={(payload, ms) => { void answer(payload, ms).catch(() => {}); }} />}
          {item?.type === 'task' && item.instance.kind === 'social-practice' && item.instance.rounds && <SupportPractice key={`${sessionId}-${step}`} rounds={item.instance.rounds} draftKey={profile && sessionId ? selectionDraftKey(profile.id, sessionId, step) : undefined} onAnswer={(cells, ms) => { void answer({ cells }, ms).catch(() => {}); }} onSkip={(ms) => { void answer({ skip: true }, ms).catch(() => {}); }} />}
          {item?.type === 'scenario' && (
            <ScenarioView key={`${sessionId}-${step}`} band={profile?.band ?? '8-10'} scenario={item} draftKey={profile && sessionId ? selectionDraftKey(profile.id, sessionId, step) : undefined} onAnswer={(a) => answer(a, 0)} />
          )}
          </fieldset>
        </div>

        {feedback && (
          <div className="feedback">
            <div className="box" role="dialog" aria-modal="true" aria-labelledby="feedback-title" aria-describedby="feedback-text" onKeyDown={(event) => { if (event.key !== 'Tab') return; const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; if (!buttons.length) return; const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
              <div className="emoji">{(item?.type === 'scenario' || (item?.type === 'task' && item.instance.kind === 'social-practice')) ? '💬' : feedback.correct ? '🎉' : '💡'}</div>
              <h3 id="feedback-title">{feedback.skipped ? 'Продолжаем!' : item?.type === 'scenario' ? 'Продолжение истории' : (item?.type === 'task' && item.instance.kind === 'social-practice') ? 'Спасибо за выбор' : feedback.correct ? 'Верно!' : 'Разберём вместе'}</h3>
              <p id="feedback-text" className={item?.type === 'scenario' ? 'story-continuation' : undefined}>{feedback.text}</p>
              {item?.type === 'scenario' && <ReadAloud text={feedback.text} />}
              {feedback.goodNote && feedback.goodNote !== feedback.text && (
                <p className="muted">{feedback.goodNote}</p>
              )}
              <div className="reward-row">
                <span className="chip xp">+{feedback.xp} XP</span>
                <span className="chip coins">🪙 +{feedback.coins}</span>
                {feedback.combo > 1 && item?.type === 'task' && item.instance.kind !== 'social-practice' && <span className="chip combo">⚡ серия ×{feedback.combo}</span>}
              </div>
              {feedback.newBadges.length > 0 && (
                <p className="badge-ping">🏅 Новый значок!</p>
              )}
              {feedback.levelUp && (
                <p className="badge-ping">🎉 Новый уровень: {feedback.levelUp.title}!</p>
              )}
              <button type="button" className="btn big" autoFocus onClick={advance}>
                {feedback.done ? 'Итоги 🏆' : 'Дальше →'}
              </button>
            </div>
          </div>
        )}
      </div>
    );

  return (
    <div className="wrap">
      <Rewards
        stars={summary?.stars ?? 0}
        xp={lastReward?.xp ?? 0}
        coins={lastReward?.coins ?? 0}
        comboBest={summary?.comboBest ?? 0}
        tasks={summary?.tasks ?? 0}
        correct={summary?.correct ?? 0}
        newBadges={lastReward?.newBadges ?? []}
        badges={badges}
        levelUp={lastReward?.levelUp ?? null}
        program={
          program
            ? {
                week: program.week,
                totalDays: program.totalDays,
                completedDays: program.completedDays,
                weekTitle: program.weekTitle,
              }
            : null
        }
        onReflect={() => { clearAcknowledged(); setStage('reflection'); }}
        onDone={() => { clearAcknowledged(); setStage('home'); }}
      />
    </div>
  );
}

/**
 * Настроение питомца: только художественная реакция на недавнюю игру.
 * Перерыв не делает питомца грустным и ничего не отнимает.
 */
function moodFor(program: ProgramInfo | null): ReturnType<typeof petMood> {
  const completedDays = program?.completedDays ?? 0;
  const last = program?.lastFinishedAt ?? null;
  // Считаем целые календарные дни по местному времени ребёнка — грубо, но честно:
  // полдня перерыва не должны менять настроение.
  const daysSinceLast = last ? Math.floor((Date.now() - last) / 86_400_000) : null;
  return petMood({ completedDays, daysSinceLast });
}

function greeting(program: ProgramInfo | null, player: PlayerInfo | null): string {
  if (!program) return 'Лис готов!';
  if (program.finished) return 'Программа пройдена! Лис гордится тобой. Играем ещё?';
  if (program.completedDays === 0) return `Начинаем! Неделя 1: ${program.weekTitle}. Готов к миссии?`;
  const days = program.completedDays;
  if (days % 7 === 0) return 'Неделя позади — красиво! Что скажешь, продолжим?';
  return `День ${program.day} недели ${program.week}: ${program.dayTheme}. Поехали!`;
}

function Onboarding({ onDone, onCancel }: { onDone: (name: string, age: number, timeZone: string) => Promise<void>; onCancel?: () => void }) {
  const [name, setName] = useState('');
  const [age, setAge] = useState(8);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onDone(name.trim() || 'Друг', age, timeZone); }
    catch { setError('Не удалось создать профиль. Проверьте соединение и попробуйте снова.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="wrap">
      <div className="panel center onboarding">
        <img src="/art/hero.png" alt="" className="hero-art" />
        <h1>Привет, я Лис!</h1>
        <p className="muted">
          В нашем районе 12 недель приключений: когнитивные тренажёры, жизненные ситуации
          и целый город, который ты откроешь своими подвигами.
        </p>
        <h2>Как тебя зовут?</h2>
        <p className="muted">Можно придумать ник — настоящие имя и фамилию вводить не нужно.</p>
        <input
          type="text"
          value={name}
          maxLength={24}
          placeholder="Имя или ник"
          onChange={(e) => setName(e.target.value)}
        />
        <h2>Сколько тебе лет?</h2>
        <p className="muted">От возраста зависит, какие задания и ситуации тебе покажем.</p>
        <div className="age-grid">
          {Array.from({ length: 9 }, (_, i) => i + 5).map((a) => (
            <button
              key={a}
              type="button"
              className={`age-btn${age === a ? ' active' : ''}`}
              onClick={() => {
                setAge(a);
                sfx.tap();
              }}
            >
              {a}
            </button>
          ))}
        </div>
        <label htmlFor="profile-zone">Часовой пояс (выберите вместе с родителем)</label>
        <select id="profile-zone" value={timeZone} onChange={e => setTimeZone(e.target.value)}>
          {TIME_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
        </select>
        <p className="muted">От него зависят календарные расчёты и границы недель в отчёте. Для существующих профилей используется Москва.</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="btn big" disabled={saving} onClick={submit}>
          {onCancel ? '🚀 Добавить ребёнка' : '🚀 В город!'}
        </button>
        {onCancel && <button type="button" className="btn ghost" disabled={saving} onClick={onCancel}>Отмена</button>}
        <p className="muted legal">
          Программа: 12 недель, 5 тренировок в неделю. В демо сохраняются ник, возраст, часовой пояс, идентификатор родителя и игровой прогресс. Профиль создаёт законный представитель. Не вводите реальные данные в демо.
        </p>
      </div>
    </div>
  );
}
