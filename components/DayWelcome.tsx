'use client';
import { useState } from 'react';
import { nextJourneyStage, type JourneyStage } from '@/lib/day/journey-machine';
import type { AgeBand } from '@/lib/types';
import FeelingsCheckIn from './FeelingsCheckIn';
import SupportKit from './SupportKit';

/** Private stages are in component memory only; the events contain no choices. */
export default function DayWelcome({ band, starting, error, onStart, onBack }: { band: AgeBand; starting: boolean; error: string; onStart: () => void; onBack: () => void }) {
  const [phase, setPhase] = useState<JourneyStage>('checkin');
  const [showFeelings, setShowFeelings] = useState(false);
  const next = () => { const stage=nextJourneyStage(phase,{type:'checkin_done'}); if(stage) setPhase(stage); };
  const start = () => { if(nextJourneyStage(phase,{type:'pause_done'}) === 'choose_story') onStart(); };
  return <main className="wrap day-welcome"><div className="panel">
    <div className="day-welcome-heading"><img src="/art/mascot-think.png" alt="" width={64} height={64} /><div><span className="chip">Перед миссией</span><h1>Начнём в своём темпе</h1><p>Всё здесь необязательно: можно просто продолжить.</p></div></div>
    {phase === 'checkin' ? <>
      <button type="button" className="day-feelings-toggle" aria-expanded={showFeelings} onClick={() => setShowFeelings(open => !open)} disabled={starting}>💬 {showFeelings ? 'Закрыть отметку' : 'Как я сейчас? (необязательно)'}</button>
      {showFeelings && <FeelingsCheckIn band={band} />}
      <p className="muted">Отметка необязательна, не сохраняется и не отправляется в отчёт.</p>
      <div className="day-welcome-actions"><button type="button" className="btn big" onClick={next}>Продолжить →</button><button type="button" className="btn ghost" onClick={onBack}>Домой</button></div>
    </> : <>
      <SupportKit competency="" band={band} />
      <p className="muted">Передышка необязательна и не влияет на награды.</p>
      {error && <div role="alert" className="request-error">{error}</div>}
      <div className="day-welcome-actions"><button type="button" className="btn big" disabled={starting} onClick={start}>{starting ? 'Открываем…' : 'Перейти к миссии →'}</button><button type="button" className="btn ghost" disabled={starting} onClick={onBack}>Домой</button></div>
    </>}
  </div></main>;
}
