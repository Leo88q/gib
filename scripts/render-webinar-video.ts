/**
 * Сборка видео-вебинаров локально через ffmpeg (0 ₽, без сети).
 *
 * Для каждого вебинара собирает mp4 в двух форматах из ОДНИХ кадров и ОДНОЙ
 * озвучки:
 *   9:16 → out/webinars/video/<audience>/<slug>.9x16.mp4  (1080×1920)
 *   16:9 → out/webinars/video/<audience>/<slug>.16x9.mp4  (1920×1080)
 * Кадр на слайд — out/webinars/art/<slideId>-c1.png (уникальный, см. webinar-art.ts),
 * голос — out/webinars/audio/<hash>.mp3 (alena, см. webinar-tts.ts). Никаких
 * переиспользованных кадров: чего не хватает — скрипт честно скажет и ничего
 * не соберёт наполовину.
 *
 * Текст на кадре (нижняя треть: название слайда; верх: линейка и счётчик слайдов)
 * включается по возможности: шрифт берётся из --font / WEBINAR_FONT_FILE /
 * public/fonts/opendyslexic-regular.woff2 / системного fc-list, и только если
 * ffmpeg реально его жуёт. Иначе рендер идёт без текста с предупреждением.
 *
 * Требования: ffmpeg и ffprobe в PATH (brew install ffmpeg).
 *
 * Запуск:
 *   npx tsx scripts/render-webinar-video.ts                    # все 48 × оба формата
 *   npx tsx scripts/render-webinar-video.ts --audience=parent --format=9x16
 *   npx tsx scripts/render-webinar-video.ts --slug=01-кто --fps=25 --pad=0.35
 *   npx tsx scripts/render-webinar-video.ts --force            # пересобрать сегменты
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argValue, OUT_DIR } from './yandex-api.ts';
import { buildPlan, type WebinarAudience } from './webinars-lib.ts';

const argv = process.argv.slice(2);
const formatArg = (argValue(argv, 'format') ?? 'all').toLowerCase();
const audience = argValue(argv, 'audience') as WebinarAudience | undefined;
const slugFilter = argValue(argv, 'slug');
const fps = Number(argValue(argv, 'fps') ?? '25');
const pad = Number(argValue(argv, 'pad') ?? '0.35');
const force = argv.includes('--force');
const overlayMode = (argValue(argv, 'overlay') ?? 'auto').toLowerCase();
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const fontArg = argValue(argv, 'font') ?? process.env.WEBINAR_FONT_FILE;

if (audience && audience !== 'teacher' && audience !== 'parent') {
  console.error('--audience: teacher | parent'); process.exit(1);
}
if (!['all', '9x16', '16x9'].includes(formatArg)) {
  console.error('--format: 9x16 | 16x9 | all'); process.exit(1);
}
const formats = formatArg === 'all' ? (['9x16', '16x9'] as const) : ([formatArg] as ('9x16' | '16x9')[]);

const hasTool = (tool: string): boolean => {
  try { execFileSync(tool, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
};
if (!hasTool('ffmpeg') || !hasTool('ffprobe')) {
  console.error('Нужны ffmpeg и ffprobe в PATH (mac: brew install ffmpeg). Сборка ничего не меняет в репозитории.');
  process.exit(1);
}
const ffprobeDuration = (file: string): number => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(out.trim()) || 0;
};

const SIZE: Record<'9x16' | '16x9', { w: number; h: number }> = { '9x16': { w: 1080, h: 1920 }, '16x9': { w: 1920, h: 1080 } };
const FORMAT_LABEL: Record<WebinarAudience, string> = { teacher: 'Для учителей', parent: 'Для родителей' };

// --- Шрифт для drawtext: берём первый, который ffmpeg реально использует ----
const fontCandidates = [
  fontArg,
  join('public', 'fonts', 'opendyslexic-regular.woff2'),
].filter((v): v is string => Boolean(v));
// Системные кандидаты (mac + linux)
for (const p of [
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
]) fontCandidates.push(p);
try {
  const fc = execFileSync('fc-match', ['-f', '%{file}', 'DejaVu Sans:style=Bold'], { encoding: 'utf8' }).trim();
  if (fc) fontCandidates.push(fc);
} catch { /* fc-list нет — не беда */ }

const probeFont = (font: string): boolean => {
  if (!existsSync(font)) return false;
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1', '-vf', `drawtext=text='a':fontfile=${font.replace(/:/g, '\\:')}:fontsize=24:fontcolor=white`, '-frames:v', '1', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch { return false; }
};
let fontFile: string | null = overlayMode === 'off' ? null : fontCandidates.find(probeFont) ?? null;
if (overlayMode !== 'off' && !fontFile) {
  console.warn('! Ни один шрифт не подошёл для drawtext — рендер без текста на кадре (только картинка + голос).');
}

/** Экранирование текста для drawtext: внутрь single quotes, спецсимволы с бэкслешием. */
const escapeDrawtext = (text: string): string =>
  text.replace(/[\u0000-\u001F]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, '’')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    .slice(0, 90);

// --- Префлайт: НИЧЕГО не собираем, пока чего-то не хватает -------------------
const plan = buildPlan(audience, slugFilter);
const webinars = Number.isFinite(limit) ? plan.webinars.slice(0, limit) : plan.webinars;
const missing: string[] = [];
for (const w of webinars) {
  for (const s of w.slides) {
    const art = join(OUT_DIR, 'webinars', 'art', `${s.id}-c1.png`);
    const audio = join(OUT_DIR, 'webinars', 'audio', `${s.hash}.mp3`);
    if (!existsSync(art)) missing.push(`кадр: out/webinars/art/${s.id}-c1.png`);
    if (!existsSync(audio)) missing.push(`голос: out/webinars/audio/${s.hash}.mp3`);
  }
}
if (missing.length > 0) {
  const unique = [...new Set(missing)];
  console.error(`Не хватает ${unique.length} файлов — сборка остановлена (ничего не собрано):`);
  for (const m of unique.slice(0, 12)) console.error(`  - ${m}`);
  if (unique.length > 12) console.error(`  …и ещё ${unique.length - 12}`);
  console.error('\nСначала: scripts/webinar-tts.ts --yes (озвучка) и scripts/webinar-art.ts --yes (кадры).');
  process.exit(1);
}

console.log('Видео-вебинары — сборка (ffmpeg, локально, 0 ₽)');
console.log(`  выпусков: ${webinars.length} | форматов: ${formats.join(', ')} | fps ${fps} | пауза в конце слайда ${pad} с`);
console.log(`  текст на кадре: ${fontFile ? `да (${fontFile})` : 'нет (шрифт не найден)'}`);

const zoompan = (frames: number, w: number, h: number): string =>
  `zoompan=z='min(zoom+0.0011,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps}`;

let rendered = 0;
const failures: string[] = [];
for (const w of webinars) {
  for (const fmt of formats) {
    const { w: W, h: H } = SIZE[fmt];
    const segDir = join(OUT_DIR, 'webinars', 'video', w.audience, w.slug, fmt);
    mkdirSync(segDir, { recursive: true });
    const segPaths: string[] = [];
    for (const s of w.slides) {
      const segPath = join(segDir, `seg-${String(s.index).padStart(3, '0')}.mp4`);
      segPaths.push(segPath);
      if (!force && existsSync(segPath) && statSync(segPath).size > 8192) continue;
      const art = join(OUT_DIR, 'webinars', 'art', `${s.id}-c1.png`);
      const audio = join(OUT_DIR, 'webinars', 'audio', `${s.hash}.mp3`);
      const seconds = Math.max(2.5, ffprobeDuration(audio) + pad);
      const frames = Math.round(seconds * fps);
      const fontSizeTitle = fmt === '9x16' ? 40 : 44;
      const fontSizeMeta = fmt === '9x16' ? 26 : 26;
      const filters = [
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
        zoompan(frames, W, H),
      ];
      if (fontFile) {
        const font = fontFile.replace(/:/g, '\\:');
        filters.push(
          `drawtext=text='${escapeDrawtext(`Гиб · ${FORMAT_LABEL[w.audience]}`)}':fontfile=${font}:fontsize=${fontSizeMeta}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=14:x=40:y=40`,
          `drawtext=text='${escapeDrawtext(`${s.index + 1}/${w.slides.length}`)}':fontfile=${font}:fontsize=${fontSizeMeta}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=14:x=w-text_w-40:y=40`,
          `drawtext=text='${escapeDrawtext(s.title)}':fontfile=${font}:fontsize=${fontSizeTitle}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=h-text_h-120`,
        );
      }
      const filterComplex = `[0:v]${filters.join(',')}[v]`;
      const args = ['-y', '-loop', '1', '-framerate', String(fps), '-i', art, '-i', audio, '-filter_complex', filterComplex, '-map', '[v]', '-map', '1:a', '-t', String(seconds), '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', segPath];
      try { execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
      catch (error) { failures.push(`${w.id} ${fmt} seg ${s.index}: ${error instanceof Error ? error.message.slice(0, 140) : error}`); }
    }
    if (failures.length > 0) break;
    const concatFile = join(segDir, 'concat.txt');
    // Пути — абсолютные: concat-демуксер резолвит их относительно concat.txt.
    const abs = (p: string): string => (p.startsWith('/') ? p : join(process.cwd(), p));
    writeFileSync(concatFile, segPaths.map((p) => `file '${abs(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const finalOut = join(OUT_DIR, 'webinars', 'video', w.audience, `${w.slug}.${fmt}.mp4`);
    mkdirSync(join(OUT_DIR, 'webinars', 'video', w.audience), { recursive: true });
    try {
      execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', finalOut], { stdio: ['ignore', 'ignore', 'pipe'] });
      rendered++;
      const mb = (statSync(finalOut).size / 1024 / 1024).toFixed(1);
      console.log(`  ok ${w.audience}/${w.slug}.${fmt}.mp4 (${w.slides.length} слайдов, ${mb} МБ)`);
    } catch (error) {
      failures.push(`${w.id} ${fmt}: concat: ${error instanceof Error ? error.message.slice(0, 140) : error}`);
      break;
    }
  }
  if (failures.length > 0) break;
}

if (failures.length > 0) {
  console.error(`\nСборка остановлена, ошибок: ${failures.length}`);
  for (const f of failures.slice(0, 10)) console.error(`  ! ${f}`);
  process.exit(1);
}
console.log(`\nГотово: ${rendered} роликов в out/webinars/video/. Публикация (MAX/YouTube/сайт) — только вручную и по отдельному решению; скрипт ничего никуда не отправляет.`);
