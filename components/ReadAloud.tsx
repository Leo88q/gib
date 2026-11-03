'use client';

import { useEffect, useState } from 'react';

/** Только озвучивание заданного текста; ввод голоса и запись не используются. */
export default function ReadAloud({ text }: { text: string }) {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setSpeaking(false);
    setAvailable('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    return () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); };
  }, [text]);
  if (!available) return null;
  const toggle = () => {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ru-RU';
      const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('ru'));
      if (voice) utterance.voice = voice;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => { setSpeaking(false); setError(true); };
      setError(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch { setSpeaking(false); setError(true); }
  };
  return <div className="read-aloud"><button type="button" onClick={toggle} aria-pressed={speaking}>{speaking ? '⏹ Остановить' : '🔊 Прочитать вслух'}</button><small>Озвучка устройства; её доступность и обработка текста зависят от браузера.</small>{error && <small role="alert">Озвучка недоступна. Можно прочитать текст самостоятельно.</small>}</div>;
}
