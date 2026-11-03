'use client';

/**
 * Мини-звук: короткие сигналы на WebAudio, без внешних файлов.
 * Звук можно отключить — переключатель хранится в localStorage.
 */

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = typeof localStorage !== 'undefined' && localStorage.getItem('gib:muted') === '1';
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem('gib:muted', value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.02);
}

export const sfx = {
  tap() {
    tone(660, 0, 0.07, 'triangle', 0.08);
  },
  correct() {
    tone(660, 0, 0.1, 'square', 0.07);
    tone(880, 0.09, 0.12, 'square', 0.07);
    tone(1180, 0.18, 0.16, 'square', 0.06);
  },
  wrong() {
    tone(220, 0, 0.16, 'sawtooth', 0.05);
    tone(165, 0.12, 0.2, 'sawtooth', 0.05);
  },
  coin() {
    tone(1046, 0, 0.08, 'triangle', 0.08);
    tone(1568, 0.07, 0.14, 'triangle', 0.07);
  },
  combo(n: number) {
    const base = 520 + Math.min(n, 8) * 60;
    tone(base, 0, 0.1, 'square', 0.06);
    tone(base * 1.25, 0.08, 0.12, 'square', 0.05);
  },
  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.07));
  },
  badge() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.08, 0.26, 'sine', 0.08));
  },
  finish() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.08));
  },
};
