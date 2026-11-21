/**
 * Озвучка всего корпуса историй через Yandex SpeechKit (TTS v1).
 *
 * Зачем: гранта Яндекса хватает на озвучку всех 452 ink-файлов многократно —
 * при ~1 ₽ за 1000 символов весь корпус (≈326 тыс. знаков) стоит меньше 500 ₽.
 * Это самый дешёвый способ вырасти продукту «в полный рост» до #SUPPORT_RU:
 * голос = отдельный канал доступа для детей 5–7 лет и слабовидящих.
 *
 * Что делает: обходит content/ink, извлекает произнесённые строки (см.
 * extractUtterances), схлопывает ПОЛНЫЕ дубликаты реплик (одинаковые фразы —
 * один файл, одна трата), в сухом прогоне печатает объём и оценку стоимости,
 * с --yes синтезирует mp3 в out/audio/tts/<hash>.mp3 и пишет
 * out/tts-manifest.json (файл → реплика → файл). Итоги дописывает в
 * out/ai-grant-spend.jsonl.
 *
 * В репозиторий mp3 не коммитятся; отобранные для релиза файлы позже переносим
 * в public/audio осознанно.
 *
 * Запуск:
 *   npx tsx scripts/yandex-tts.ts                 # сухой прогон: объём и цена
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-tts.ts --yes --limit=50
 *   YANDEX_TTS_VOICE=alena YANDEX_API_KEY=... npx tsx scripts/yandex-tts.ts --yes
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, extractUtterances, folderId, hasYesFlag,
  readInk, runPool, utteranceHash, walkInk, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const rate = Number(argValue(argv, 'rate') ?? '1.3'); // ₽ за 1000 символов
const voice = process.env.YANDEX_TTS_VOICE ?? 'alena';
const audioDir = join(OUT_DIR, 'audio', 'tts');

const files = walkInk();
const manifest: { file: string; index: number; text: string; hash: string; out: string }[] = [];
const seen = new Map<string, { out: string }>();
let totalChars = 0;
let uniqueChars = 0;

for (const file of files) {
  const utterances = extractUtterances(readInk(file));
  utterances.forEach((text, index) => {
    totalChars += text.length;
    const hash = utteranceHash(text);
    const out = join(audioDir, `${hash}.mp3`);
    manifest.push({ file, index, text, hash, out });
    if (!seen.has(hash)) {
      seen.set(hash, { out });
      uniqueChars += text.length;
    }
  });
}

const unique = [...seen.entries()];
const todo = Number.isFinite(limit) ? unique.slice(0, limit) : unique;
const cost = (todo.reduce((sum, [text]) => sum + text.length, 0) / 1000) * rate;

console.log('SpeechKit TTS — сухой расчёт');
console.log(`  файлов ink: ${files.length}`);
console.log(`  строк всего: ${manifest.length} (${totalChars} символов)`);
console.log(`  уникальных реплик: ${unique.length} (${uniqueChars} символов)`);
console.log(`  к синтезу сейчас: ${todo.length} реплик → оценочно ${cost.toFixed(2)} ₽ (курс ${rate} ₽/1000 симв., голос ${voice})`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
mkdirSync(audioDir, { recursive: true });
const key = apiKey();
let done = 0;
let failed = 0;

await runPool(todo, 4, async ([text]) => {
  const hash = utteranceHash(text);
  const target = join(audioDir, `${hash}.mp3`);
  if (existsSync(target)) {
    done++;
    return;
  }
  const body = new URLSearchParams({
    folderId: folderId(),
    text: text.slice(0, 4500),
    lang: 'ru-RU',
    voice,
    format: 'mp3',
  });
  const response = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
    method: 'POST',
    headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    failed++;
    console.error(`  ! ${response.status} для «${text.slice(0, 60)}…»: ${(await response.text()).slice(0, 200)}`);
    return;
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  done++;
  if (done % 50 === 0) console.log(`  …синтезировано ${done} реплик`);
});

writeFileSync(join(OUT_DIR, 'tts-manifest.json'), JSON.stringify({ voice, folderId: folderId(), manifest }, null, 2));
appendSpend({ tool: 'speechkit-tts', unique_lines: todo.length, chars: todo.reduce((s, [t]) => s + t.length, 0), rate_per_1000_rub: rate, cost_estimate_rub: cost, failed });
console.log(`\nГотово: ${done} синтезировано, ${failed} ошибок. Манифест и журнал: ${OUT_DIR}/tts-manifest.json, ${join(OUT_DIR, 'ai-grant-spend.jsonl')}`);
if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
