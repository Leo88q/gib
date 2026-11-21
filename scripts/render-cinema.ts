/**
 * Рендер вертикальных intro-роликов для кинематографичного режима.
 *
 * Что делает: для каждого отобранного кадра out/cinema/_stills/<scenarioId>-<band>.png
 * (пользователь кладёт туда свои финалисты из out/art — ffmpeg сам не выбирает,
 * какой кандидат хороший) собирает вертикальный 1080×1920 ролик:
 * размытый фон + само изображение поверх + медленный зум (Ken Burns) +
 * закадровый голос из out/audio/tts/<hash>.mp3 (хэш — от ПЕРВОЙ реплики ink-файла,
 * той же функции, что в yandex-tts.ts; корпус уже озвучен на гранте).
 *
 * Стоимость: 0 ₽ генерации (ffmpeg локально) — только ваш просмотр и выбор кадров.
 *
 * Требования: ffmpeg и ffprobe в PATH (brew install ffmpeg).
 *
 * Запуск:
 *   npx tsx scripts/render-cinema.ts             # рендерить всё из _stills
 *   npx tsx scripts/render-cinema.ts --only=w1   # только неделя 1
 *   npx tsx scripts/render-cinema.ts --fps=25 --seconds=7
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  argValue, extractUtterances, readInk, utteranceHash, walkInk, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const only = argValue(argv, 'only');
const fps = Number(argValue(argv, 'fps') ?? '25');
const fixedSeconds = Number(argValue(argv, 'seconds') ?? '0'); // 0 = по длине голоса + 0.6 c, минимум 5 c
const forceRender = argv.includes('--force');
const stillsDir = join(OUT_DIR, 'cinema', '_stills');
const cinemaDir = join(OUT_DIR, 'cinema');
const audioDir = join(OUT_DIR, 'audio', 'tts');

const STILL = /^(w\d+d\d+[a-z_0-9]*)-(5-7|8-10|11-13)\.(png|jpe?g)$/;

const utteranceByKey = new Map<string, string>();
for (const file of walkInk()) {
  const name = basename(file, '.ink');
  const match = /^(w\d+d\d+[a-z_0-9]*)-(5-7|8-10|11-13)$/.exec(name);
  if (!match) continue;
  const first = extractUtterances(readInk(file))[0];
  if (first) utteranceByKey.set(`${match[1]}/${match[2]}`, first);
}

const stills = existsSync(stillsDir)
  ? readdirSync(stillsDir).map((name) => ({ name, full: join(stillsDir, name) })).filter((s) => STILL.test(s.name))
  : [];
const plan = stills.filter((s) => !only || s.name.startsWith(only));

console.log('Cinema-рендер (ffmpeg Ken Burns + голос)');
console.log(`  кадров из ${stillsDir}: ${plan.length}${only ? ` (фильтр only=${only})` : ''}`);
if (plan.length === 0) {
  console.log('\nПоложите отобранные файлы как out/cinema/_stills/<scenarioId>-<band>.png, напр. w1d1-5-7.png');
  process.exit(0);
}

const ffprobeDuration = (file: string): number => {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch { return 0; }
};

let done = 0;
let silent = 0;
for (const still of plan) {
  const match = STILL.exec(still.name);
  if (!match) continue;
  const [, scene, band] = match;
  const outDir = join(cinemaDir, scene, band);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'intro.mp4');
  if (!forceRender && existsSync(out) && statSync(out).size > 4096) {
    console.log(`  skip ${scene}/${band} (уже есть; --force для пересборки)`);
    done++;
    continue;
  }

  const utterance = utteranceByKey.get(`${scene}/${band}`);
  const mp3 = utterance ? join(audioDir, `${utteranceHash(utterance)}.mp3`) : null;
  const hasVoice = mp3 ? existsSync(mp3) : false;
  if (!hasVoice) silent++;

  const voiceDur = hasVoice ? ffprobeDuration(mp3!) : 0;
  const seconds = Math.max(5, fixedSeconds > 0 ? fixedSeconds : voiceDur + 0.6);
  const frames = Math.round(seconds * fps);

  const vf = [
    "split=2[bg][fg]",
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:20[bg2]",
    "[fg]scale=1080:-1[fg2]",
    "[bg2][fg2]overlay=(W-w)/2:(H-h)/2[base]",
    `[base]zoompan=z='min(zoom+0.0015,1.12)':d=${frames}:s=1080x1920:fps=${fps}`,
  ].join(';');

  const args = ['-y', '-loop', '1', '-i', still.full];
  if (hasVoice) args.push('-i', mp3!);
  args.push('-filter_complex', vf, '-map', '0:v');
  if (hasVoice) args.push('-map', '1:a');
  args.push('-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', out);

  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    copyFileSync(still.full, join(outDir, 'intro.jpg'));
    done++;
    console.log(`  ok ${scene}/${band} (${seconds.toFixed(1)} c${hasVoice ? '' : ', без голоса — не найден mp3'})`);
  } catch (error) {
    console.error(`  ! ffmpeg (${scene}/${band}): ${error instanceof Error ? error.message.slice(0, 160) : error}`);
  }
}

console.log(`\nГотово: ${done}/${plan.length} роликов${silent ? ` (без голоса: ${silent})` : ''}.`);
console.log('Дальше: npx tsx scripts/build-cinema-manifest.ts && cp -r out/cinema/w1d1 public/cinema/ (или весь каталог) && git add public/cinema');
