/**
 * Пути к картинкам v2 («мягкий объём»).
 *
 * Здесь только связка «доменный идентификатор → файл». Сами пути и список
 * существ/мест живут в `lib/design/tokens.ts`, чтобы не было второго источника
 * правды: проверка `scripts/test-art-paths.ts` сверяет, что каждый путь из
 * этих функций существует на диске и является настоящим PNG.
 *
 * Что изменилось против старой версии:
 *  - иконки навыков — это существа навыков (светлячок, белка, осьминог…),
 *    а не «иконка внимания»;
 *  - компетенции и недели показывают **место района**, а не ещё одну зверушку
 *    и не отдельную сцену на каждую из 60 историй;
 *  - неизвестный идентификатор уходит на безопасный дефолт, а не в 404.
 */
import { creatureArt, placeForCompetency, DEFAULT_CREATURE_ART, DEFAULT_PLACE_ART } from './design/tokens.ts';
import { petStage } from './pet-mood.ts';

/** Навык программы → существо навыка. `working_memory` — это «память». */
const SKILL_CREATURE: Record<string, string> = {
  attention: 'attention',
  working_memory: 'memory',
  flexibility: 'flexibility',
  inhibition: 'inhibition',
  planning: 'planning',
  logic: 'logic',
};

/** Три проводника. Больше героев в продукте нет. */
const HEROES = ['lis', 'mira', 'tima'] as const;
export type HeroId = (typeof HEROES)[number];

/** Имя героя линейки — его произносит интерфейс, а не картинка. */
export const HERO_NAME: Record<string, string> = { '5-7': 'Лис', '8-10': 'Мира', '11-13': 'Тима' };

/** Подпись линейки для экрана: «8–10 лет». */
export const BAND_LABEL: Record<string, string> = { '5-7': '5–7 лет', '8-10': '8–10 лет', '11-13': '11–13 лет' };

/** Дефолт для картинки, которой нет: Лис, а не битая картинка. */
export const DEFAULT_ART = DEFAULT_CREATURE_ART;

/** Дефолтная сцена — дом: место, с которого начинается район. */
export const DEFAULT_PLACE = DEFAULT_PLACE_ART;

/** Панорамная иллюстрация карты практики v2. */
export const MAP_BANNER_ART = '/art/v2/places/map.png';

/** Проводник по возрастной линейке: 5–7 Лис, 8–10 Мира, 11–13 Тима. */
export function heroArt(band: string): string {
  if (band === '8-10') return creatureArt('mira');
  if (band === '11-13') return creatureArt('tima');
  return creatureArt('lis');
}

/** Крупный портрет героя для маленьких круглых слотов (56–96 px).
 *  Полный рост в кружке 56 px читается как «человек вдалеке», а лицо — читается. */
export function heroFace(band: string): string {
  if (band === '8-10') return '/art/v2/creatures/mira-face.png';
  if (band === '11-13') return '/art/v2/creatures/tima-face.png';
  return '/art/v2/creatures/lis-face.png';
}

/** Портрет героя по id, для мест, где линейка не нужна. */
export function heroById(id: string): string {
  return (HEROES as readonly string[]).includes(id) ? creatureArt(id) : DEFAULT_ART;
}

/** Картинка навыка: существо навыка. */
export function skillArt(skill: string): string {
  const creature = SKILL_CREATURE[skill];
  return creature ? creatureArt(creature) : DEFAULT_ART;
}

/** Компетенция показывает своё место района. */
export function competencyArt(competency: string): string {
  return placeForCompetency(competency);
}

/**
 * Иллюстрация недели — сцена места, к которому относится компетенция недели.
 * Отдельных картинок на 12 недель больше нет: семь мест переиспользуются,
 * и это осознанно (см. `design/lesson-assets.md`).
 */
export function weekArt(week: number, competency: string): string {
  if (Number.isInteger(week) && week >= 1 && week <= 12) return placeForCompetency(competency);
  return competencyArt(competency);
}

/** 3D-иллюстрация питомца с учётом трёх возрастных стадий роста (уровни 1–2, 3–5, 6+). */
export function petStageArt(level = 1): string {
  const stage = petStage(level);
  if (stage === 1) return '/art/v2/creatures/pet-teen.png';
  if (stage === 2) return '/art/v2/creatures/pet-adult.png';
  return creatureArt('pet');
}

