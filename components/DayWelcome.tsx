'use client';
import { useRef, useState } from 'react';
import { nextJourneyStage, type JourneyStage } from '@/lib/day/journey-machine';
import type { AgeBand } from '@/lib/types';
import useJourneyResume from './useJourneyResume';
import FeelingsCheckIn from './FeelingsCheckIn';
import SupportKit from './SupportKit';

/**
 * Приватные экраны живут в памяти компонента; события не содержат выборов.
 * После перезагрузки возвращается только место остановки (см. `useJourneyResume`):
 * сами отметки чувств и передышки не сохраняются.
 */
export default function DayWelcome({ band, starting, error, onStart, onBack, profileId, day }: { band: AgeBand; starting: boolean; error: string; onStart: () => void; onBack: () => void; profileId?: string; day?: number }) {
  const [phase, setPhase] = useState<JourneyStage>('checkin');
  const resume = useJourneyResume({
    profileId,
    day,
    screen: 'welcome',
    phase: phase === 'checkin' ? 'checkin' : 'pause',
  });
  // Восстанавливаем фазу один раз, при первом рендере: дальше состояние ведёт себя как обычно.
  const initialised = useRef(false);
  if (!initialised.current && resume.resume?.phase === 'pause') {
    initialised.current = true;
    setPhase('pause');
  }
  const [restored, setRestored] = useState(resume.restored && resume.resume?.phase === 'pause');
  const [showFeelings, setShowFeelings] = useState(false);
  const next = () => { const stage=nextJourneyStage(phase,{type:'checkin_done'}); if(stage) { setRestored(false); setPhase(stage); } };
  const start = () => { if(nextJourneyStage(phase,{type:'pause_done'}) === 'choose_story') { resume.clear(); onStart(); } };
  return <main className="wrap day-welcome"><div className="panel">
    <div className="day-welcome-heading"><img src="/art/mascot-think.png" alt="" width={64} height={64} /><div><span className="chip">Перед миссией</span><h1>Начнём в своём темпе</h1><p>Всё здесь необязательно: можно просто продолжить.</p></div></div>
    {restored && <p className="muted day-welcome-restored" role="status">Ты вернулся на этот экран. Отметки не сохранялись — начать можно заново или сразу перейти к миссии.</p>}
    {phase === 'checkin' ? <>
      <button type="button" className="day-feelings-toggle" aria-expanded={showFeelings} onClick={() => setShowFeelings(open => !open)} disabled={starting}>💬 {showFeelings ? 'Закрыть отметку' : 'Как я сейчас? (необязательно)'}</button>
      {showFeelings && <FeelingsCheckIn band={band} profileId={profileId} />}
      <p className="muted">Отметка необязательна. Сохраняется только если взрослый разрешил это в кабинете, и никогда не попадает в отчёт по занятиям.</p>
      <div className="day-welcome-actions"><button type="button" className="btn big" onClick={next}>Продолжить →</button><button type="button" className="btn ghost" onClick={onBack}>Домой</button></div>
    </> : <>
      <SupportKit competency="" band={band} />
      <p className="muted">Передышка необязательна и не влияет на награды.</p>
      {error && <div role="alert" className="request-error">{error}</div>}
      <div className="day-welcome-actions"><button type="button" className="btn big" disabled={starting} onClick={start}>{starting ? 'Открываем…' : 'Перейти к миссии →'}</button><button type="button" className="btn ghost" disabled={starting} onClick={onBack}>Домой</button></div>
    </>}
  </div></main>;
}
