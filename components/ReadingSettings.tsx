'use client';
import { useEffect, useState } from 'react';
import { applyReadingPreferences, DEFAULT_READING, readReadingPreferences, READING_KEY, saveReadingPreferences, type ReadingPreferences } from '@/lib/reading-preferences';

export default function ReadingSettings() {
  const [settings, setSettings] = useState<ReadingPreferences>(DEFAULT_READING);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    const sync = () => { const value = readReadingPreferences(); setSettings(value); applyReadingPreferences(value); };
    sync(); setReady(true);
    const storage = (event: StorageEvent) => { if (event.key === READING_KEY || event.key === null) sync(); };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  const change = (next: ReadingPreferences) => { setSettings(next); setSaved(saveReadingPreferences(next)); };
  return <div className="reading-settings-wrap"><details className="reading-settings">
    <summary>⚙ Настройки чтения и движения</summary>
    <fieldset disabled={!ready}>
      <legend>Внешний вид</legend>
      <label htmlFor="reading-font">Шрифт</label>
      <select id="reading-font" value={settings.font} onChange={e => change({ ...settings, font: e.target.value === 'opendyslexic' ? 'opendyslexic' : 'standard' })}>
        <option value="standard">Обычный</option><option value="opendyslexic">OpenDyslexic</option>
      </select>
      <label className="reading-check"><input type="checkbox" checked={settings.largeText} onChange={e => change({ ...settings, largeText: e.target.checked })} /> Крупнее текст</label>
      <label className="reading-check"><input type="checkbox" checked={settings.reduceMotion} onChange={e => change({ ...settings, reduceMotion: e.target.checked })} /> Меньше движения</label>
      <small>Шрифт можно выбрать по удобству — он не гарантирует улучшения чтения. Системная настройка уменьшения движения тоже учитывается.</small>
      {!saved && <small role="status">Настройки действуют сейчас, но устройство не разрешило их сохранить.</small>}
    </fieldset>
  </details></div>;
}
