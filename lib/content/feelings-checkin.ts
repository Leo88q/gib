import type { AgeBand } from '../types';

/** Icons are optional symbols, not a way to infer feelings from facial expression. */
export const FEELINGS = [
  { id: 'joy', label: 'Радость', icon: '/openmoji/1F60A.svg' },
  { id: 'calm', label: 'Спокойствие', icon: '/openmoji/1F60C.svg' },
  { id: 'sad', label: 'Грусть', icon: '/openmoji/1F622.svg' },
  { id: 'anger', label: 'Злость', icon: '/openmoji/1F621.svg' },
  { id: 'fear', label: 'Страх', icon: '/openmoji/1F628.svg' },
  { id: 'unsure', label: 'Пока не знаю', icon: '/openmoji/1F914.svg' },
] as const;
export type FeelingId = typeof FEELINGS[number]['id'];
export const FEELING_PROMPTS: Record<AgeBand, string> = {
  '5-7': 'Как тебе сейчас? Можно выбрать картинки или пропустить.',
  '8-10': 'Что ты сейчас чувствуешь? Можно выбрать несколько слов или пропустить.',
  '11-13': 'Как ты себя сейчас ощущаешь? Можно отметить несколько чувств или пропустить.',
};
export function toggleFeeling(selected: FeelingId[], id: FeelingId): FeelingId[] {
  if (id === 'unsure') return selected.includes(id) ? [] : ['unsure'];
  const withoutUnsure = selected.filter(value => value !== 'unsure');
  return withoutUnsure.includes(id) ? withoutUnsure.filter(value => value !== id) : [...withoutUnsure, id];
}
