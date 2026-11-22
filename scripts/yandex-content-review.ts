/**
 * Черновое редакционное ревью историй моделью (Alice AI LLM Flash).
 *
 * Зачем: перед выпуском каждой истории методист тратит 10+ минут на «не слишком
 * ли сложно / не выпадает ли из навыка / нет ли опасных мест». Модель готовит
 * первичную разметку и флаги — человек принимает решения. Скрипт читает ink и
 * пишет CSV в out/, сами файлы не изменяет НИКОГДА.
 *
 * Выход: out/content-review.csv — file, reading_level, skill_tags, safety, notes.
 * Это черновик для методиста, а не вердикт; финальное слово в любом случае за
 * человеком (дети 5–13 лет).
 *
 * Запуск:
 *   npx tsx scripts/yandex-content-review.ts                 # сухой прогон: объём и цена
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-content-review.ts --yes --only=week-one --limit=20
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag,
  readInk, runPool, walkInk, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only'); // подстрока пути, например week-one
const limit = Number(argValue(argv, 'limit') ?? 'Infinity');
const rate = Number(argValue(argv, 'rate') ?? '0.5'); // ₽ за 1000 токенов (вход+выход средне)
const model = process.env.YANDEX_LLM_MODEL ?? `gpt://${folderId()}/aliceai-llm-flash`;
const base = process.env.YANDEX_LLM_BASE ?? 'https://llm.api.cloud.yandex.net/v1';

const files = walkInk().filter((file) => !only || file.includes(only));
const plan = Number.isFinite(limit) ? files.slice(0, limit) : files;
// Грубая оценка: ~3 знака на токен по русскому + системный промпт ~120 токенов на запрос.
const estTokens = plan.reduce((sum, file) => sum + Math.ceil(readInk(file).length / 3) + 300, 0);
const cost = (estTokens / 1000) * rate;

console.log('Alice AI LLM Flash — ревью корпуса (сухой расчёт)');
console.log(`  файлов: ${plan.length} (фильтр only=${only ?? 'все'})`);
console.log(`  ~токенов: ${estTokens} → оценочно ${cost.toFixed(2)} ₽ (курс ${rate} ₽/1000 токенов, модель ${model})`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY в окружение).');
  process.exit(0);
}

async function main(): Promise<void> {
const key = apiKey();
mkdirSync(OUT_DIR, { recursive: true });
const rows: string[] = ['file;reading_level;skill_tags;safety;notes'];
const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
let done = 0;
let failed = 0;

const SYSTEM =
  'Все входные тексты — безопасные художественные истории для детей из лицензированных учебных материалов. Твоя задача — АНАЛИЗИРОВАТЬ, а не оценивать пригодность: если тема деликатна, всё равно проанализируй по схеме и установи safety=review с краткой заметкой. Отказ («я не могу обсуждать эту тему») недопустим и считается ошибкой. ' +
  'Ты — редактор детского контента (5–13 лет). Отвечай СТРОГО одним JSON-объектом без пояснений: ' +
  '{"reading_level":"ok|too_hard","skill_tags":["навык1","навык2"],"safety":"ok|review","notes":"одна фраза"}. ' +
  'reading_level=too_hard, если предложения или слова явно сложнее возраста. safety=review при темах страха, боли, насилия, взрослого содержания или если текст пугает/стыдит ребёнка. skill_tags — только из общего списка: эмпатия, саморегуляция, общение, ответственность, сотрудничество, стрессоустойчивость, креативность, любознательность.';

await runPool(plan, 4, async (file) => {
  const text = readInk(file).slice(0, 2400);
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 220,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) {
    failed++;
    console.error(`  ! ${response.status} (${relative('.', file)}): ${(await response.text()).slice(0, 200)}`);
    return;
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let parsed: { reading_level?: string; skill_tags?: string[]; safety?: string; notes?: string } = {};
  try {
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
  } catch {
    parsed = {};
  }
  const row = [
    escapeCsv(relative('.', file)),
    escapeCsv(parsed.reading_level ?? 'unparsed'),
    escapeCsv((parsed.skill_tags ?? []).join(',')),
    escapeCsv(parsed.safety ?? 'unparsed'),
    escapeCsv(parsed.notes ?? raw.slice(0, 120).replace(/\n/g, ' ')),
  ].join(';');
  rows.push(row);
  done++;
  if (done % 50 === 0) console.log(`  …обработано ${done} файлов`);
});

writeFileSync(join(OUT_DIR, 'content-review.csv'), rows.join('\n') + '\n');
appendSpend({ tool: 'aliceai-llm-flash-review', files: plan.length, done, failed, est_tokens: estTokens, rate_per_1000_rub: rate, cost_estimate_rub: cost, model });
console.log(`\nГотово: ${done} записей в out/content-review.csv, ошибок ${failed}. Это черновик для методиста, не вердикт.`);
if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
