/**
 * Общий разбор вебинаров из content/webinars/*\/*​.full.md для видео-конвейера.
 *
 * Единственный источник истины о том, ЧТО идёт в ролик: озвучку берём только из
 * секции «## Текст озвучки» вычитанных файлов. Разбиение на слайды: абзацы ДО
 * первого «### » — слайд «Вступление», дальше каждый «### » — один слайд.
 * Тексты вычитаны и финальны: здесь они только чистятся для TTS (снимаем
 * markdown-разметку), но не переписываются.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { utteranceHash } from './yandex-api.ts';

export const WEBINARS_ROOT = join('content', 'webinars');
export const OUT_WEBINARS = join('out', 'webinars');
export const TTS_RATE_RUB_PER_1K = 1.3; // ₽ за 1000 символов (SpeechKit, alena)
export const ART_RATE_RUB_PER_IMAGE = 2.23; // ₽ за изображение (Alice AI ART)

export type WebinarAudience = 'teacher' | 'parent';
export const AUDIENCES: WebinarAudience[] = ['teacher', 'parent'];

export interface WebinarFile {
  audience: WebinarAudience;
  number: number; // порядковый номер из имени файла (01..36 / 01..12)
  slug: string;   // «01-кто-я-и-что-я-чувствую»
  id: string;     // `${audience}-${slug}`
  h1: string;     // полный заголовок первого уровня
  title: string;  // «…» из h1, иначе весь h1 без «# »
  metaLine: string;
  path: string;
}

export interface WebinarSlide {
  id: string;       // `${webinar.id}-s01`
  webinarId: string;
  index: number;    // 0-based
  title: string;    // подпись слайда («Вступление» или текст «### »)
  isIntro: boolean;
  narration: string; // очищенный для TTS текст (заголовок + тело)
  chars: number;
  hash: string;     // sha1(narration)[:16] — ключ кэша озвучки/файла mp3
}

const FULL_MD = /^(\d+)-([a-z0-9а-яё-]+)\.full\.md$/i;

export function listWebinarFiles(audience?: WebinarAudience): WebinarFile[] {
  const files: WebinarFile[] = [];
  for (const aud of AUDIENCES) {
    if (audience && audience !== aud) continue;
    const dir = join(WEBINARS_ROOT, aud);
    for (const entry of readdirSync(dir)) {
      const match = FULL_MD.exec(entry);
      if (!match) continue; // .md (без .full) и README пропускаем
      const path = join(dir, entry);
      const raw = readFileSync(path, 'utf8');
      const h1Match = /^#\s+(.+)$/m.exec(raw);
      const h1 = (h1Match?.[1] ?? entry).trim();
      const guillemets = /«([^»]+)»/.exec(h1);
      const title = (guillemets?.[1] ?? h1.replace(/^#\s+/, '')).trim();
      const afterH1 = h1Match ? raw.slice((h1Match.index ?? 0) + h1Match[0].length).trimStart() : '';
      const metaLine = (afterH1.split('\n').find((l) => l.trim().length > 0) ?? '').trim();
      files.push({ audience: aud, number: Number(match[1]), slug: entry.replace(/\.full\.md$/i, ''), id: `${aud}-${entry.replace(/\.full\.md$/i, '')}`, h1, title, metaLine, path });
    }
  }
  return files.sort((a, b) => (a.audience === b.audience ? a.number - b.number : a.audience.localeCompare(b.audience)));
}

/** Разметку снимаем, смысл не трогаем: «**жирный**», заголовки, маркеры списков. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-–]\s+/gm, '') // маркеры списка — паузы, не символы
    .replace(/^\s*\d+\.\s+/gm, '') // нумерованные списки
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // ссылки
    .replace(/`+([^`]+)`+/g, '$1') // код
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0E}\u{FE0F}]/gu, '') // эмодзи
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('. ') // абзац/строка → фраза; точки дают паузу в TTS
    .replace(/\.\s*\./g, '.') // двойные точки от пустых строк
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Вырезает секцию «## Текст озвучки» (до ближайшего следующего заголовка того же уровня). */
export function extractNarrationSection(raw: string, path = '<stdin>'): string {
  const match = /^##\s+Текст озвучки[^\n]*\n([\s\S]*?)(?=^##\s|(?<![\s\S]))/m.exec(raw);
  if (!match) throw new Error(`${path}: нет секции «## Текст озвучки»`);
  return match[1].trim();
}

/** Разбиение секции на слайды: до первого «### » — «Вступление», дальше по «### ». */
export function splitIntoSlides(webinar: WebinarFile, section: string): WebinarSlide[] {
  const slides: WebinarSlide[] = [];
  const parts = section.split(/^###\s+/m);
  const push = (heading: string | null, body: string): void => {
    const cleanBody = cleanForSpeech(body);
    const cleanHead = heading ? cleanForSpeech(heading) : null;
    const narration = (cleanHead ? `${cleanHead}. ${cleanBody}` : cleanBody).replace(/\s{2,}/g, ' ').trim();
    if (!narration) return;
    const index = slides.length;
    slides.push({
      id: `${webinar.id}-s${String(index).padStart(2, '0')}`,
      webinarId: webinar.id,
      index,
      title: cleanHead ?? 'Вступление',
      isIntro: heading === null,
      narration,
      chars: narration.length,
      hash: utteranceHash(narration),
    });
  };
  const [preamble, ...rest] = parts;
  if (preamble.trim()) push(null, preamble);
  for (const part of rest) {
    const nl = part.indexOf('\n');
    const heading = nl === -1 ? part.trim() : part.slice(0, nl).trim();
    const body = nl === -1 ? '' : part.slice(nl + 1);
    push(heading, body);
  }
  return slides;
}

export interface WebinarPlanEntry extends WebinarFile {
  slides: WebinarSlide[];
  chars: number;
  estTtsRub: number;
}

export interface WebinarPlan {
  generatedAt: string;
  webinars: WebinarPlanEntry[];
  totals: { webinars: number; slides: number; chars: number; uniqueNarrations: number; uniqueChars: number; estTtsRub: number; estArtRubPerCandidate: number };
}

export function buildPlan(audience?: WebinarAudience, slugFilter?: string): WebinarPlan {
  const files = listWebinarFiles(audience).filter((f) => !slugFilter || f.slug.includes(slugFilter));
  const webinars: WebinarPlanEntry[] = files.map((file) => {
    const raw = readFileSync(file.path, 'utf8');
    const section = extractNarrationSection(raw, file.path);
    const slides = splitIntoSlides(file, section);
    const chars = slides.reduce((sum, s) => sum + s.chars, 0);
    return { ...file, slides, chars, estTtsRub: (chars / 1000) * TTS_RATE_RUB_PER_1K };
  });
  const unique = new Map<string, WebinarSlide>();
  for (const w of webinars) for (const s of w.slides) if (!unique.has(s.hash)) unique.set(s.hash, s);
  const uniqueChars = [...unique.values()].reduce((sum, s) => sum + s.chars, 0);
  const slides = webinars.reduce((sum, w) => sum + w.slides.length, 0);
  return {
    generatedAt: new Date().toISOString(),
    webinars,
    totals: {
      webinars: webinars.length,
      slides,
      chars: webinars.reduce((sum, w) => sum + w.chars, 0),
      uniqueNarrations: unique.size,
      uniqueChars,
      estTtsRub: (uniqueChars / 1000) * TTS_RATE_RUB_PER_1K,
      estArtRubPerCandidate: slides * ART_RATE_RUB_PER_IMAGE,
    },
  };
}
