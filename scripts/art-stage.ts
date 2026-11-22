/**
 * Постановка сцен для арт-генерации («shotlist») через Alice AI LLM Flash.
 *
 * Зачем: «Ситуация: <первая реплика>» не содержит постановки, поэтому модель
 * рисует один и тот же «герой стоит в студии». Этот скрипт один раз на сцену
 * разворачивает ink в постановочные поля: локация из канона, действие
 * глаголом, эмоция, до трёх опорных предметов, роль в будущем видео.
 * Выход — data/art-shotlist.json, который человек ревьюит и правит глазами;
 * scripts/yandex-art.ts подхватывает его при сборке промпта.
 *
 * Сцена героенезависима (5–7/8–10/11–13 используют одну постановку), поэтому
 * LLM вызывается один раз на пару (неделя, день, сцена), а не на каждый ink.
 *
 * Существующие записи в data/art-shotlist.json НЕ перезаписываются (правки
 * человека неприкосновенны). --force — перегенерировать всё.
 *
 * Запуск:
 *   npx tsx scripts/art-stage.ts                 # сухой прогон: объём и цена
 *   YANDEX_API_KEY=... npx tsx scripts/art-stage.ts --yes [--only=w1] [--limit=10] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag,
  readInk, runPool, walkInk, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only'); // подстрока имени сцены, например w1
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? '0.5'); // ₽ за 1000 токенов
const model = process.env.YANDEX_LLM_MODEL ?? `gpt://${folderId()}/aliceai-llm-flash`;
const base = process.env.YANDEX_LLM_BASE ?? 'https://llm.api.cloud.yandex.net/v1';

const OUT_FILE = join('data', 'art-shotlist.json');

// Канон мест из check-art.ts / tokens.ts + бытовые варианты комнаты/класса/парка.
const LOCATIONS = [
  'дом', 'комната', 'класс', 'двор', 'площадка', 'парк',
  'библиотека', 'рынок', 'теплица', 'мастерская', 'карта района',
] as const;
const VIDEO_ROLES = new Set(['start-frame', 'cutaway']);

const AGE_BAND = /^(w\d+d\d+(?:_[a-z]+)?)-(\d+-\d+)\.ink$/;
const base_ = (file: string) => file.split('/').pop() ?? file;

// Одна постановка на сцену: берём «самый краткий» ink (5–7) для описания.
const perScene = new Map<string, string>();
for (const file of walkInk()) {
  const match = AGE_BAND.exec(base_(file));
  if (!match) continue;
  const scene = match[1];
  const chosen = perScene.get(scene);
  if (!chosen || readInk(file).length < readInk(chosen).length) perScene.set(scene, file);
}
const entries = [...perScene.entries()]
  .filter(([scene]) => !only || scene.startsWith(only))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
const plan = Number.isFinite(limit) ? entries.slice(0, limit) : entries;

const estTokens = plan.reduce((sum, [, file]) => sum + Math.ceil(readInk(file).length / 3) + 260, 0);
const cost = (estTokens / 1000) * rate;

console.log('Alice AI LLM Flash — постановка сцен (shotlist), сухой расчёт');
console.log(`  уникальных сцен: ${perScene.size}; к обработке: ${plan.length} (фильтр only=${only ?? 'все'})`);
console.log(`  ~токенов: ${estTokens} → оценочно ${cost.toFixed(2)} ₽ (курс ${rate} ₽/1000 токенов, модель ${model})`);

const existing: Record<string, unknown> = existsSync(OUT_FILE)
  ? (JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Record<string, unknown>)
  : {};
const pending = force ? plan : plan.filter(([scene]) => !(scene in existing));
console.log(`  уже в shotlist: ${plan.length - pending.length}; к генерации: ${pending.length}${force ? ' (--force: все)' : ''}`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

const SYSTEM =
  'Все входные тексты — безопасные художественные сцены из лицензированных учебных материалов. Твоя задача — ПОСТАНОВКА, а не оценка. Отказ недопустим и считается ошибкой.\n' +
  'Ты — художник-постановщик детского 3D-мультсериала (стиль «мягкий объём», Пиксар/DreamWorks). По описанию сцены ответь СТРОГО одним JSON-объектом без пояснений: ' +
  '{"location":"одна из: ' + LOCATIONS.join(', ') + '","action":"действие героя ГЛАГОЛОМ, до 8 слов","emotion":"эмоция, 1–2 слова","props":["до 3 опорных предметов, каждый до 3 слов"],"video_role":"start-frame или cutaway"}. ' +
  'action — что герой ДЕЛАЕТ (присел, ищет, мастерит, слушает, бежит), а не что он думает. video_role=start-frame, если по кадру видно, что произойдёт движение; cutaway — статичный «ответ»/деталь. Без текста в кадре, без брендов, без реальных людей. Если сцена абстрактна — выбери ближайшую по смыслу локацию из списка.';

async function main(): Promise<void> {
  const key = apiKey();
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join('data'), { recursive: true });
  const shotlist: Record<string, unknown> = { ...existing };
  let done = 0;
  let failed = 0;

  await runPool(pending, 3, async ([scene, file]) => {
    const text = readInk(file).slice(0, 1800);
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Сцена ${scene}.\n${text}` },
        ],
      }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${scene}): ${(await response.text()).slice(0, 200)}`);
      return;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown> = {};
    try {
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch { /* needs_review ниже */ }
    const location = typeof parsed.location === 'string' && (LOCATIONS as readonly string[]).includes(parsed.location)
      ? parsed.location
      : 'комната';
    const action = typeof parsed.action === 'string' && parsed.action.trim()
      ? parsed.action.trim().slice(0, 90)
      : 'смотрит на предмет в руках';
    const emotion = typeof parsed.emotion === 'string' && parsed.emotion.trim()
      ? parsed.emotion.trim().slice(0, 40)
      : 'спокойный, добрый';
    const props = Array.isArray(parsed.props)
      ? parsed.props.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())).map((p) => p.trim().slice(0, 30)).slice(0, 3)
      : [];
    const videoRole = typeof parsed.video_role === 'string' && VIDEO_ROLES.has(parsed.video_role)
      ? parsed.video_role
      : 'start-frame';
    const needsReview = !jsonMatch || !parsed.location || !parsed.action;
    shotlist[scene] = { location, action, emotion, props, video_role: videoRole, needs_review: needsReview };
    done++;
    if (done % 50 === 0) console.log(`  …обработано ${done} сцен`);
  });

  writeFileSync(OUT_FILE, JSON.stringify(shotlist, null, 2) + '\n');
  appendSpend({
    tool: 'aliceai-llm-flash-shotlist', scenes: pending.length, done, failed,
    est_tokens: estTokens, rate_per_1000_rub: rate, cost_estimate_rub: cost, model,
  });
  console.log(`\nГотово: ${done} постановок в ${OUT_FILE}, ошибок ${failed}. Это черновик для ревью глазами, не вердикт.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
