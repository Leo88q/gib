'use client';
import { useEffect, useRef, useState } from 'react';
import garden from '@/lib/content/ink/garden.json';
import rumor from '@/lib/content/ink/rumor.json';
import ReadAloud from './ReadAloud';
import type { Story } from 'inkjs';

type View = { text: string; choices: { index: number; text: string }[] };
const stories = { garden, rumor };
export default function InkStory({ storyId }: { storyId: keyof typeof stories }) {
  const story = useRef<Story | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const read = (current: Story) => {
    let text = '';
    while (current.canContinue) text += current.Continue();
    setView({ text: text.trim(), choices: current.currentChoices.map(c => ({ index: c.index, text: c.text })) });
  };
  useEffect(() => {
    let cancelled = false;
    story.current = null; setView(null); setError(false);
    void import('inkjs').then(({ Story }) => {
      if (cancelled) return;
      const current = new Story(JSON.stringify(stories[storyId]));
      story.current = current; read(current);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; story.current = null; };
  }, [storyId, version]);
  const choose = (index: number) => {
    try { if (story.current) { story.current.ChooseChoiceIndex(index); read(story.current); } }
    catch { setError(true); }
  };
  return <div className="support-game story-game">
    <h3>{storyId === 'garden' ? 'Сад общих идей' : 'Новость в чате'}</h3>
    {!view && !error && <p role="status">История загружается…</p>}
    {error && <p role="alert">Не удалось открыть историю. Попробуй начать заново.</p>}
    {view && <><div className="story-speech" aria-live="polite"><span aria-hidden="true">🦊</span><p>{view.text}</p></div>
      <ReadAloud text={view.text} />
      <div className="options">{view.choices.map(c => <button type="button" className="option" key={c.index} onClick={() => choose(c.index)}>{c.text}</button>)}</div>
      {!view.choices.length && <p>История завершена. Можно выбрать другой путь.</p>}</>}
    <button className="story-restart" type="button" onClick={() => setVersion(v => v + 1)}>Начать заново</button>
  </div>;
}
