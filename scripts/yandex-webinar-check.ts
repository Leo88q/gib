/**
 * Самопроверка всех вебinars LLM'ом перед публикацией.
 *
 * Что делает: каждый вебинар (teacher/ + parent/) читает Alice AI LLM Flash и
 * возвращает структурированный вердикт: нет ли выдуманных фактов/чисел/исследований,
 * нет ли небезопасных формулировок для детской аудитории, соответствует ли текст
 * общей тональности серии, список «проверяемых утверждений» (каждое должна
 * подтвердить вычитка человеком / методист). Вердикт — НЕ авто-одобрение:
 * итоговое «публиковать / не публиковать» принимает человек.
 *
 * Запуск:
 *   npx tsx scripts/yandex-webinar-check.ts                  # сухой прогон
 *   YANDEX_API_KEY=... npx tsx scripts/yandex-webinar-check.ts --yes [--only=01]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool, OUT_DIR,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only');
const rate = Number(argValue(argv, 'rate') ?? '0.5');
const model = process.env.YANDEX_LLM_MODEL ?? `gpt://${folderId()}/aliceai-llm-flash`;
const base = process.env.YANDEX_LLM_BASE ?? 'https://llm.api.cloud.yandex.net/v1';
const DIRS = [join('content', 'webinars', 'teacher'), join('content', 'webinars', 'parent')];

const files = DIRS.flatMap((dir) => readdirSync(dir)
  .filter((name) => /^\d\d-.*\.md$/.test(name) && !name.endsWith('.full.md'))
  .map((name) => join(dir, name)))
  .filter((file) => !only || file.split('/').pop()?.startsWith(only))
  .sort();

const estTokens = files.reduce((sum, file) => sum + Math.ceil(readFileSync(file, 'utf8').length / 3) + 400, 0);
const cost = (estTokens / 1000) * rate;

console.log('Alice AI LLM Flash — самопроверка вебинаров');
console.log(`  файлов: ${files.length}${only ? ` (фильтр only=${only})` : ''}`);
console.log(`  ~токенов: ${estTokens} → оценочно ${cost.toFixed(2)} ₽`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Запуск: добавьте --yes (и YANDEX_API_KEY).');
  process.exit(0);
}

const SYSTEM =
  'Все входные тексты — безопасные методические материалы для детей и родителей из лицензированных учебных программ. Твоя задача — ПРОВЕРКА, а не оценка ценности. Отказ недопустим и считается ошибкой.\n' +
  'Ответь СТРОГО одним JSON-объектом без пояснений: ' +
  '{"invented_facts":true|false,"invented_items":["..."],"unsafe":true|false,"unsafe_items":["..."],"tone_ok":true|false,"checkable_claims":["каждое утверждение, которое должен подтвердить человек"],"verdict":"ok|fix|block"}. ' +
  'invented_facts=true, если встречаются числа/проценты/исследования/законы без источника или выдуманные герои/названия вне программы. unsafe=true, если есть давление на ребёнка, стыд, терапия силами педагога, личные данные детей. tone_ok=false, если текст звучит как реклама или лекция. verdict: ok=чисто, fix=есть что поправить, block=публиковать нельзя.';

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const key = apiKey();
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = ['file;facts;facts_items;unsafe;unsafe_items;tone_ok;verdict;checkable_claims'];
  let done = 0;
  let failed = 0;

  await runPool(files, 3, async (file) => {
    const text = readFileSync(file, 'utf8').slice(0, 8000);
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.1, max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${file}): ${(await response.text()).slice(0, 160)}`);
      return;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed: Record<string, unknown> = {};
    try { if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>; } catch { /* ниже */ }
    const arr = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(' | ') : '';
    rows.push([
      escapeCsv(file.replace(/^content\/webinars\//, '')),
      escapeCsv(String(parsed.invented_facts ?? '?')),
      escapeCsv(arr(parsed.invented_items)),
      escapeCsv(String(parsed.unsafe ?? '?')),
      escapeCsv(arr(parsed.unsafe_items)),
      escapeCsv(String(parsed.tone_ok ?? '?')),
      escapeCsv(String(parsed.verdict ?? 'unparsed')),
      escapeCsv(arr(parsed.checkable_claims)),
    ].join(';'));
    done++;
  });

  writeFileSync(join(OUT_DIR, 'webinar-check.csv'), rows.join('\n') + '\n');
  appendSpend({ tool: 'aliceai-llm-flash-webinar-check', files: files.length, done, failed, est_tokens: estTokens, rate_per_1000_rub: rate, cost_estimate_rub: cost, model });
  console.log(`\nГотово: ${done} вердиктов в out/webinar-check.csv, ошибок ${failed}. Это НЕ авто-одобрение: «verdict=ok» смотрит человек, прежде чем публиковать.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
