/**
 * Сборка public/cinema/manifest.json из отрендеренных роликов.
 *
 * Запускается ПОСЛЕ scripts/render-cinema.ts. Сканирует out/cinema/<scenarioId>/<band>/
 * и прописывает int intro/poster в манифест, который клиент загружает один раз
 * за сессию. Без роликов манифест остаётся пустым — режим просто не включается.
 *
 * Запуск: npx tsx scripts/build-cinema-manifest.ts [--dir=out/cinema]
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argValue } from './yandex-api.ts';

const argv = process.argv.slice(2);
const dir = argValue(argv, 'dir') ?? join('out', 'cinema');
const outFile = join('public', 'cinema', 'manifest.json');

const SCENE_DIR = /^w\d+d\d+[a-z_0-9]*$/;
const BAND_DIR = /^(5-7|8-10|11-13)$/;

const entries: Record<string, { intro: string; poster?: string }> = {};
let missingIntro = 0;

if (existsSync(dir)) {
  for (const scene of readdirSync(dir)) {
    const scenePath = join(dir, scene);
    if (!SCENE_DIR.test(scene) || !statSync(scenePath).isDirectory()) continue;
    for (const band of readdirSync(scenePath)) {
      const bandPath = join(scenePath, band);
      if (!BAND_DIR.test(band) || !statSync(bandPath).isDirectory()) continue;
      const intro = join(bandPath, 'intro.mp4');
      if (!existsSync(intro) || statSync(intro).size < 1024) { missingIntro++; continue; }
      const poster = ['intro.jpg', 'intro.png'].map((n) => join(bandPath, n)).find(existsSync);
      entries[`${scene}/${band}`] = {
        intro: `/cinema/${scene}/${band}/intro.mp4`,
        ...(poster ? { poster: `/cinema/${scene}/${band}/${poster.split('/').pop()}` } : {}),
      };
    }
  }
}

mkdirSync(join('public', 'cinema'), { recursive: true });
writeFileSync(outFile, JSON.stringify({ version: 1, entries }, null, 2) + '\n');
console.log(`cinema-manifest: ${Object.keys(entries).length} роликов → ${outFile}${missingIntro ? ` (пропущено без intro.mp4: ${missingIntro})` : ''}`);
console.log('Ролики из out/cinema кладём в public/cinema/ перед релизом (или монтируем как статику).');
