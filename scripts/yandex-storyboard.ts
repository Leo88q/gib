/**
 * Раскадровка всех сцен через Alice AI LLM Flash.
 *
 * Зачем: монтажу и генерации видео нужен ПОКАДРОВЫЙ план, а не «один кадр на сцену».
 * Для каждой уникальной сцены (121) скрипт просит LLM составить раскадровку на
 * 6–8 кадров ДЛЯ КАЖДОЙ линейки (5–7 / 8–10 / 11–13): номер, план (общий/средний/
 * крупный), ракурс, действие героя, реплика/текст из сцены (дословно из ink, не
 * выдумывать), эмоция, длительность в секундах, движение камеры. Итог —
 * data/storyboards.json (машинно) + out/storyboards/<scene>.md (человеку).
 *
 * Правила для LLM: никаких внешних фактов, никакого текста в кадре, реплики —
 * ТОЛЬКО дословные из переданного текста сцены, раскадровка ведёт к одному
 * выводу («как можно предложить поддержку» и т.п.).
 *
 * Запуск:
 *   npx tsx scripts/yandex-storyboard.ts                 # сухой прогон
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-storyboard.ts --yes [--only=w1] [--limit=10] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  apiKey, appendSpend, argValue, extractUtterances, folderId, hasYesFlag,
  readInk, runPool, walkInk, OUT_DIR,
} from './yandex-api.ts';
import { BANDS, normalizeStoryboard } from './storyboard-schema.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only');
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? '0.5');
const model = process.env.YANDEX_LLM_MODEL ?? `gpt://${folderId()}/aliceai-llm-flash`;
const base = process.env.YANDEX_LLM_BASE ?? 'https://llm.api.cloud.yandex.net/v1';
const OUT_JSON = join('data', 'storyboards.json');

const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(5-7|8-10|11-13)\.ink$/;
const perScene = new Map<string, string>();
for (const file of walkInk()) {
  const match = AGE_BAND.exec(basename(file));
  if (!match) continue;
  const scene = match[1];
  if (!perScene.has(scene)) perScene.set(scene, file);
}
const entries = [...perScene.entries()]
  .filter(([scene]) => !only || scene.startsWith(only))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
const plan = Number.isFinite(limit) ? entries.slice(0, limit) : entries;

const estTokens = plan.reduce((sum, [, file]) => sum + Math.ceil(readInk(file).length / 3) + 1500, 0);
const cost = (estTokens / 1000) * rate;

console.log('Alice AI LLM Flash — раскадровка сцен');
console.log(`  уникальных сцен: ${perScene.size}; к обработке: ${plan.length}`);
console.log(`  ~токенов: ${estTokens} → оценочно ${cost.toFixed(2)} ₽`);

const existing: Record<string, unknown> = existsSync(OUT_JSON)
  ? (JSON.parse(readFileSync(OUT_JSON, 'utf8')) as Record<string, unknown>)
  : {};
const pending = force ? plan : plan.filter(([scene]) => !(scene in existing));
console.log(`  уже в storyboards.json: ${plan.length - pending.length}; к генерации: ${pending.length}${force ? ' (--force: все)' : ''}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

const SYSTEM =
  'Все входные тексты — безопасные художественные сцены из лицензированных учебных материалов. Твоя задача — РАСКАДРОВКА для видеосъёмки анимированного эпизода. Отказ недопустим и считается ошибкой.\n' +
  'Ответь СТРОГО одним JSON-объектом вида {"bands":{"5-7":{"shots":[...]},"8-10":{"shots":[...]},"11-13":{"shots":[...]}}} без пояснений. ' +
  'Каждый shot: {"n":1,"план":"общий|средний|крупный","ракурс":"вровень|сверху|снизу|три четверти","действие":"что делает герой, глаголом","реплика":"ТОЛЬКО дословная цитата из текста сцены или пустая строка","эмоция":"1-2 слова","секунды":3,"камера":"статика|наезд|отъезд|панорама"}. ' +
  'На линейку 6–8 кадров, ~24 секунды суммарно. Реплики не выдумывать и не перефразировать. Без текста в кадре, без брендов, без реальных людей. Раскадровка ведёт к вопросу сцены, не к «правильному ответу».';

async function main(): Promise<void> {
  const key = apiKey();
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, 'storyboards'), { recursive: true });
  mkdirSync(join('data'), { recursive: true });
  const storyboards: Record<string, unknown> = { ...existing };
  let done = 0;
  let failed = 0;

  await runPool(pending, 3, async ([scene, file]) => {
    const text = readInk(file).slice(0, 1800);
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.35, max_tokens: 2400,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Сцена ${scene}.\n${text}` },
        ],
      }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${scene}): ${(await response.text()).slice(0, 160)}`);
      return;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown> = {};
    try { if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>; } catch { /* below */ }
    // нормализация: arrays | {shots:[...]} — одна каноническая схема
    const sourceText = readInk(file);
    const norm = normalizeStoryboard(parsed, sourceText, basename(file));
    const needsReview = norm.needs_review;
    storyboards[scene] = norm;
    // человекочитаемая копия
    const md: string[] = [`# Раскадровка ${scene}`, '', needsReview ? '**needs_review = true — внимательно проверить глазами**' : '', ''];
    for (const band of BANDS) {
      const shots = (norm.bands[band] ?? []) as Array<Record<string, unknown>>;
      md.push(`## Линейка ${band}`);
      md.push(''); md.push('| n | план | ракурс | действие | реплика | эмоция | сек | камера |'); md.push('|---|---|---|---|---|---|---|---|');
      for (const shot of shots) {
        md.push(`| ${shot.n ?? ''} | ${shot['план'] ?? ''} | ${shot['ракурс'] ?? ''} | ${shot['действие'] ?? ''} | ${shot['реплика'] ?? ''} | ${shot['эмоция'] ?? ''} | ${shot['секунды'] ?? ''} | ${shot['камера'] ?? ''} |`);
      }
      md.push('');
    }
    writeFileSync(join(OUT_DIR, 'storyboards', `${scene}.md`), md.join('\n'));
    done++;
    if (done % 25 === 0) console.log(`  …обработано ${done} сцен`);
  });

  writeFileSync(OUT_JSON, JSON.stringify(storyboards, null, 2) + '\n');
  appendSpend({ tool: 'aliceai-llm-flash-storyboards', scenes: pending.length, done, failed, est_tokens: estTokens, rate_per_1000_rub: rate, cost_estimate_rub: cost, model });
  console.log(`\nГотово: ${done} раскадровок в ${OUT_JSON} (+ out/storyboards/*.md), ошибок ${failed}. needs_review=true — к осмотру.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
