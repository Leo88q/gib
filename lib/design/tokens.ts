/**
 * Токены дизайн-системы «мягкий объём».
 *
 * Здесь только значения, без React и без CSS: этим файлом пользуются и
 * компоненты, и проверка `scripts/test-design-tokens.ts`. Источник правды для
 * палитры — `design/style-passport.md` и макет `design/preview/index.html`;
 * тест сверяет токены с макетом, поэтому расхождение видно сразу, а не через
 * полгода при переносе экрана.
 *
 * Правило, ради которого всё затевалось: **один акцент на экран**. Проводники
 * цветные, существа навыков и предметы — тёплые нейтральные с одним свечением.
 */

/** Базовые цвета. Больше нигде в коде hex-значения не пишем. */
export const COLORS = {
  /** текст, обводки, тёмные детали */
  ink: '#241D31',
  /** основной текст абзацев */
  inkSoft: '#544B63',
  /** подписи, метки, второстепенное */
  inkFaint: '#7D7590',
  /** фон карточек и картинок */
  cream: '#FDF4E9',
  /** фон страницы под карточками */
  creamDeep: '#F7E9D8',
  /** поверхность карточки */
  paper: '#FFFFFF',
  /** разделители и тонкие обводки */
  line: '#ECE0D2',
  /** акцент линейки 5–7 (Лис) */
  lis: '#EC6F38',
  /** акцент линейки 8–10 (Мира) */
  mira: '#2E9E80',
  /** акцент линейки 11–13 (Тима) */
  tima: '#5A68C6',
  /** награда, свечение, состояние «надето» */
  gold: '#F2B544',
} as const;

/** Мягкие подложки под акцент: плашки, чипы, фоновые пятна. */
export const COLOR_SOFT = {
  lis: '#FFE6D8',
  mira: '#DFF2EA',
  tima: '#E6E8FA',
  gold: '#FDEFD0',
} as const;

/** Возрастная линейка → проводник → его акцент. Ровно три, не больше. */
export const HERO_ACCENTS = [
  { band: '5-7', hero: 'Лис', color: COLORS.lis },
  { band: '8-10', hero: 'Мира', color: COLORS.mira },
  { band: '11-13', hero: 'Тима', color: COLORS.tima },
] as const;

/**
 * Правила цвета как числа, чтобы их можно было проверить.
 * Девять акцентных цветов в одном продукте не читаются — это ограничение,
 * а не пожелание.
 */
export const ACCENT_RULE = {
  /** сколько акцентных цветов допустимо на одном экране */
  maxPerScreen: 1,
  /** сколько акцентных цветов у проводников программы */
  heroAccents: 3,
  /** сколько своих акцентных цветов у существ навыков */
  creatureAccents: 0,
} as const;

/** Шкала типографики в px (на экране ставится с `clamp`, здесь — опорные размеры). */
export const TYPE_SCALE = {
  display: 68,
  h1: 38,
  h2: 26,
  h3: 20,
  body: 16,
  small: 13.5,
  caption: 12,
} as const;

/** Радиусы. Прямых углов в детском регистре нет. */
export const RADIUS = { xl: 34, lg: 26, md: 18, sm: 12, pill: 999 } as const;

/** Шаг сетки отступов в px. */
export const SPACE = [4, 8, 12, 18, 26, 34, 48, 64] as const;

/** Тени: сначала мягкая цветная, потом внутренний блик — из них и берётся объём. */
export const SHADOW = {
  card: '0 28px 56px -30px rgba(36,29,49,.38), 0 2px 0 rgba(255,255,255,.9) inset',
  float: '0 40px 80px -40px rgba(36,29,49,.45)',
} as const;

/* ------------------------------------------------------------------ арт */

/**
 * Контракт ассетов. Идентификаторы — доменные, файлы — на диске; связь описана
 * здесь, чтобы новый экран не собирал пути руками.
 */
export const CREATURES = ['lis', 'mira', 'tima', 'attention', 'memory', 'flexibility', 'inhibition', 'planning', 'logic', 'pet'] as const;

/** 19 предметов: гардероб, комната, упражнения. */
export const ITEMS = [
  'cap', 'bandana', 'glasses', 'headphones', 'crown', 'scarf', 'backpack', 'vest', 'super',
  'rug', 'lamp', 'poster', 'plant',
  'block', 'bubble', 'shapes', 'cards', 'hourglass', 'notebook',
] as const;

/** Семь мест района. */
export const PLACES = ['home', 'yard', 'library', 'playground', 'market', 'greenhouse', 'workshop'] as const;

/** Компетенция программы → место района. Седьмой зверь здесь не появляется. */
export const PLACE_BY_COMPETENCY = {
  self_awareness: 'home',
  self_regulation: 'yard',
  empathy: 'library',
  relationships: 'playground',
  decision_making: 'market',
  creative_thinking: 'workshop',
  growth_mindset: 'greenhouse',
} as const;

export type CreatureId = (typeof CREATURES)[number];
export type ItemId = (typeof ITEMS)[number];
export type PlaceId = (typeof PLACES)[number];

export const DEFAULT_CREATURE_ART = '/art/v2/creatures/lis.png';
export const DEFAULT_ITEM_ART = '/art/v2/items/block.png';
export const DEFAULT_PLACE_ART = '/art/v2/places/home.png';

function art(folder: 'creatures' | 'items' | 'places', id: string, list: readonly string[], fallback: string): string {
  // Неизвестный идентификатор уходит на безопасный дефолт: битой картинки на
  // экране быть не должно, а доменный id приходит из данных, а не от человека.
  if (!list.includes(id)) return fallback;
  return `/art/v2/${folder}/${id}.png`;
}

export function creatureArt(id: string): string {
  return art('creatures', id, CREATURES, DEFAULT_CREATURE_ART);
}

export function itemArt(id: string): string {
  return art('items', id, ITEMS, DEFAULT_ITEM_ART);
}

export function placeArt(id: string): string {
  return art('places', id, PLACES, DEFAULT_PLACE_ART);
}

/** Место для компетенции: неизвестная компетенция ведёт домой, а не в пустоту. */
export function placeForCompetency(competency: string): string {
  const id = (PLACE_BY_COMPETENCY as Record<string, string>)[competency];
  return placeArt(id ?? 'home');
}
