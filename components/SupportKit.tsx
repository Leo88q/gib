'use client';

import { useState } from 'react';
import { SAFETY_STORY } from '@/lib/content/safety-story';
import ReadAloud from './ReadAloud';
import BubbleGame from './BubbleGame';
import BlockPuzzle from './BlockPuzzle';
import InkStory from './InkStory';
import FeelingsCheckIn from './FeelingsCheckIn';
import type { AgeBand } from '@/lib/types';
import { MINI_STORIES } from '@/lib/content/mini-stories';

type Activity = 'bubbles' | 'rainbow' | 'color' | 'hug' | 'move' | 'water' | 'safety' | 'feelings' | 'boundaries' | 'practice' | 'blocks' | 'garden' | 'rumor' | 'checkin';
const activities: { id: Activity; label: string; icon: string }[] = [
  { id: 'bubbles', label: 'Пузырьки', icon: '🫧' },
  { id: 'rainbow', label: 'Радуга', icon: '🌈' },
  { id: 'color', label: 'Раскраска', icon: '🎨' },
  { id: 'hug', label: 'Поддержка', icon: '🧡' },
  { id: 'move', label: 'Разминка', icon: '🌿' },
  { id: 'water', label: 'Вода', icon: '💧' },
  { id: 'safety', label: 'Секрет в игре', icon: '🛡️' },
  { id: 'feelings', label: 'Рисунок Лиса', icon: '🖼️' },
  { id: 'checkin', label: 'Как я сейчас?', icon: '💬' },
  { id: 'boundaries', label: 'Башня', icon: '🧱' },
  { id: 'practice', label: 'Мост', icon: '🌉' },
  { id: 'blocks', label: 'План команды', icon: '🧩' },
  { id: 'garden', label: 'Сад идей', icon: '🌱' },
  { id: 'rumor', label: 'Новость', icon: '📰' },
];
const colors = ['#ffcc45', '#fb8178', '#86c9ef', '#a9d986', '#bca4ed'];

const recommended: Record<string, Activity> = { self_awareness: 'feelings', self_regulation: 'rainbow', empathy: 'feelings', relationships: 'boundaries', decision_making: 'safety', creative_thinking: 'practice', growth_mindset: 'practice' };

export default function SupportKit({ competency, band }: { competency: string; band: AgeBand }) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [breaths, setBreaths] = useState(0);
  const [color, setColor] = useState(colors[0]);
  const [painted, setPainted] = useState<Record<number, string>>({});
  const [step, setStep] = useState(0);
  const [storyNode, setStoryNode] = useState('start');
  const select = (id: Activity) => { setActivity(id); setBreaths(0); setPainted({}); setStep(0); setStoryNode('start'); };
  return (
    <section className="support-kit" aria-label="Набор поддержки">
      <button className="support-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        🧰 Набор поддержки <span>{open ? 'Свернуть ↑' : 'Открыть ↓'}</span>
      </button>
      {open && <div className="support-content">
        <img className="support-art" src="/art/support-workshop.png" alt="Лис в мастерской с радугой и пузырьками" />
        <p>Хочешь сделать паузу? Выбери игру. Можно пропустить и продолжить историю.</p>
        <p className="support-hint">Для этой темы Лис предлагает: {activities.find(a => a.id === recommended[competency])?.label ?? 'любую игру'}.</p>
        <div className="support-menu" aria-label="Выбери занятие">
          {activities.map(a => <button key={a.id} type="button" aria-pressed={activity === a.id} onClick={() => select(a.id)}><span aria-hidden="true">{a.icon}</span>{a.label}</button>)}
        </div>
        {activity && MINI_STORIES[activity] && <div className="support-game story-game">
          <h3>{MINI_STORIES[activity].title}</h3>
          <div className="story-speech" aria-live="polite"><span aria-hidden="true">🦊</span><p>{MINI_STORIES[activity].nodes[storyNode].text}</p></div>
          <ReadAloud text={MINI_STORIES[activity].nodes[storyNode].text} />
          <div className="options">{MINI_STORIES[activity].nodes[storyNode].choices.map(choice => <button className="option" type="button" key={choice.label} onClick={() => setStoryNode(choice.next)}>{choice.label}</button>)}</div>
          {storyNode !== 'start' && <button className="story-restart" type="button" onClick={() => setStoryNode('start')}>Начать историю заново</button>}
        </div>}
        {activity === 'safety' && <div className="support-game story-game">
          <h3>Секрет в игре</h3>
          <div className="story-speech" aria-live="polite"><span aria-hidden="true">🦊</span><p>{SAFETY_STORY[storyNode].text}</p></div>
          <ReadAloud text={SAFETY_STORY[storyNode].text} />
          {SAFETY_STORY[storyNode].ending && <p>Это история для тренировки — здесь не нужно указывать свои данные.</p>}
          <div className="options">{SAFETY_STORY[storyNode].choices.map(choice => <button className="option" type="button" key={choice.label} onClick={() => setStoryNode(choice.next)}>{choice.label}</button>)}</div>
          {storyNode !== 'start' && <button className="story-restart" type="button" onClick={() => setStoryNode('start')}>Начать историю заново</button>}
        </div>}
        {activity === 'checkin' && <FeelingsCheckIn band={band} />}
        {activity === 'bubbles' && <BubbleGame target={band === '5-7' ? 6 : band === '8-10' ? 8 : 10} />}
        {activity === 'blocks' && <BlockPuzzle />}
        {(activity === 'garden' || activity === 'rumor') && <InkStory storyId={activity} />}
        {activity === 'rainbow' && <div className="support-game">
          <h3>Радуга в своём темпе</h3><div className="rainbow-picture" aria-hidden="true">🌈</div>
          <p>Если тебе удобно, сделай спокойный вдох и выдох. Никаких задержек дыхания: дыши как обычно. Нажми на облако, когда захочешь.</p>
          <button className="cloud-button" type="button" onClick={() => setBreaths(b => Math.min(5, b + 1))}>☁️ Добавить цвет</button>
          <div className="rainbow-progress" aria-label={`Цветов радуги: ${breaths} из 5`}>{colors.map((c, i) => <span key={c} style={{ background: i < breaths ? c : '#e4dfd5' }} />)}</div>
          <p aria-live="polite">{breaths === 5 ? 'Радуга готова! Остановись, если упражнение неприятно.' : `Цветов: ${breaths} из 5`}</p>
        </div>}
        {activity === 'color' && <div className="support-game">
          <h3>Раскрась домик Лиса</h3><p>Выбери цвет, затем нажми на часть домика. Любой выбор подходит!</p>
          <div className="paint-palette">{colors.map((c, i) => <button key={c} type="button" aria-label={`Цвет ${i + 1}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
          <div className="paint-house">{['Крыша', 'Стена', 'Дверь', 'Окно'].map((part, i) => <button type="button" key={part} style={{ background: painted[i] || '#fff' }} onClick={() => setPainted({ ...painted, [i]: color })}>{part}</button>)}</div>
          <button type="button" className="btn" onClick={() => setPainted({})}>Начать заново</button>
        </div>}
        {activity === 'hug' && <div className="support-game"><h3>Тёплая поддержка</h3><div className="rainbow-picture" aria-hidden="true">🧡</div><p>Можно обнять себя, положить руку на плечо или просто посидеть удобно. Выбирай только то, что приятно.</p><button type="button" className="btn" onClick={() => setStep(1)}>Выбрать слова Лиса</button>{step > 0 && <p aria-live="polite">«Я рядом. Можно попросить помощи у взрослого, которому ты доверяешь».</p>}</div>}
        {activity === 'move' && <div className="support-game"><h3>Разминка с Лисом</h3><p>{['Если удобно, мягко потянись вверх. Можно остаться сидеть.', 'Пошевели плечами или кистями так, как тебе комфортно.', 'Готово! Отдохни. Если что-то неприятно — остановись.'][step]}</p><button type="button" className="btn" onClick={() => setStep((step + 1) % 3)}>{step === 2 ? 'Ещё раз' : 'Дальше →'}</button></div>}
        {activity === 'water' && <div className="support-game"><h3>Водная остановка</h3><div className="rainbow-picture" aria-hidden="true">💧</div><p>Если хочешь пить и вода рядом, сделай глоток. Можно попросить взрослого помочь. Пить не обязательно.</p><button type="button" className="btn" onClick={() => setStep(1)}>Вернуться в историю</button>{step > 0 && <p aria-live="polite">Лис подождал тебя. Продолжим, когда будешь готов!</p>}</div>}
      </div>}
    </section>
  );
}
