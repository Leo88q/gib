/**
 * Общая деривация «ключ кадра» для каталога переиспользуемых кадров.
 *
 * Идея владельца (2026-11-21): один и тот же кадр вставляется в разные
 * сцены и ролики, а не генерируется «по одному на урок». Ключ — грубая
 * постановочная семантика: герой (линеечно-зависим) × локация × эмоция.
 * Точную эмоцию/локацию даёт data/art-shotlist.json (art-stage, ≈25 ₽);
 * без него — та же оффлайн-эвристика, что и у yandex-art.ts, помеченная
 * needs_review: true.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Канон локаций из art-stage.ts → слаги (английские, для ключей и файлов). */
export const LOCATION_SLUG: Record<string, string> = {
  'дом': 'house',
  'комната': 'room',
  'класс': 'class',
  'двор': 'yard',
  'площадка': 'playground',
  'парк': 'park',
  'библиотека': 'library',
  'рынок': 'market',
  'теплица': 'greenhouse',
  'мастерская': 'workshop',
  'карта района': 'district-map',
};

const LOC_HINTS: [RegExp, string][] = [
  [/крас|мастер|инструмент|самодел|почин/i, 'мастерская'],
  [/книг|библиотек|читальн/i, 'библиотека'],
  [/рын|покупа|лавк|ярмар/i, 'рынок'],
  [/тепли|растени|семен|сад/i, 'теплица'],
  [/площадк|качел|горк/i, 'площадка'],
  [/двор|улиц/i, 'двор'],
  [/парк|алле/i, 'парк'],
  [/урок|класс|учитель|школа/i, 'класс'],
  [/дом|комнат|кладов/i, 'комната'],
];

const EMOTION_SLUG: [RegExp, string][] = [
  [/спокой|добр/i, 'calm'],
  [/радост|весел|счастлив/i, 'happy'],
  [/груст|печаль|печал|тоск/i, 'sad'],
  [/зл|серд|ярост|агресс/i, 'angry'],
  [/испуг|бо[яюь]|страх/i, 'scared'],
  [/удив/i, 'surprised'],
  [/стыд|смущ/i, 'ashamed'],
  [/растер|недоум/i, 'confused'],
  [/устал/i, 'tired'],
  [/увер/i, 'sure'],
  [/трев|взволнов/i, 'anxious'],
  [/задум/i, 'thoughtful'],
  [/горд|доволен/i, 'proud'],
];

export const HERO_BY_BAND: Record<string, 'lis' | 'mira' | 'tima'> = {
  '5-7': 'lis',
  '8-10': 'mira',
  '11-13': 'tima',
};

export type ShotlistEntry = {
  location?: string;
  emotion?: string;
  action?: string;
  needs_review?: boolean;
};

export function loadShotlist(): Record<string, ShotlistEntry> {
  try {
    return JSON.parse(readFileSync(join('data', 'art-shotlist.json'), 'utf8')) as Record<string, ShotlistEntry>;
  } catch {
    return {};
  }
}

export function heuristicLocation(text: string): string | undefined {
  return LOC_HINTS.find(([re]) => re.test(text))?.[1];
}

export function emotionSlug(emotion: string): { slug: string; known: boolean } {
  for (const [re, slug] of EMOTION_SLUG) if (re.test(emotion)) return { slug, known: true };
  return { slug: 'calm', known: false };
}

export function locationSlug(raw: string): string {
  return LOCATION_SLUG[raw] ?? 'room';
}

export type Stage = { location: string; emotion: string; needs_review: boolean; source: 'shotlist' | 'heuristic' };

export function deriveStage(scene: string, sceneText: string, shotlist: Record<string, ShotlistEntry>): Stage {
  const shot = shotlist[scene];
  if (shot?.location) {
    return {
      location: shot.location,
      emotion: (shot.emotion ?? 'спокойный, добрый').trim(),
      needs_review: Boolean(shot.needs_review),
      source: 'shotlist',
    };
  }
  return {
    location: heuristicLocation(sceneText) ?? 'комната',
    emotion: 'спокойный, добрый',
    needs_review: true,
    source: 'heuristic',
  };
}

/** Ключ кадра с героем: lis-room-calm. */
export function heroFrameKey(scene: string, band: string, stage: Stage): string {
  const hero = HERO_BY_BAND[band];
  const { slug: emo } = emotionSlug(stage.emotion);
  return `${hero}-${locationSlug(stage.location)}-${emo}`;
}

/** Ключ B-roll локации без героя: loc-room. */
export function locationFrameKey(stage: Stage): string {
  return `loc-${locationSlug(stage.location)}`;
}

/** Формат ключей каталога. */
export const FRAME_KEY = /^(lis|mira|tima|loc)-[a-z0-9][a-z0-9-]*$/;
