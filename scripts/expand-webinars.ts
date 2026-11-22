/**
 * Добор вебинаров до полных 25–30 минут через Alice AI LLM Flash.
 *
 * Зачем: генератор (gen-lesson-webinars.ts) даёт ~3 100 слов (~21 мин) — предел
 * того, что можно собрать без выдумывания. Живые 25–30 требуют авторских
 * кейсов. Этот скрипт отправляет КАЖДЫЙ вебинар модели с жёсткими правилами:
 * цитаты из кода не трогаем, выдуманные факты и исследования запрещены, добор
 * только кейсами/разговорами/уточнениями. Результат пишется в <name>.full.md —
 * исходник не перезаписывается; .full.md всегда проходит read-through человека.
 *
 * Запуск:
 *   npx tsx scripts/expand-webinars.ts                 # сухой прогон
 *   YANDEX_API_KEY=... npx tsx scripts/expand-webinars.ts --yes [--only=01]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  apiKey, appendSpend, argValue, folderId, hasYesFlag, runPool,
} from './yandex-api.ts';

const argv = process.argv.slice(2);
const yes = hasYesFlag(argv);
const only = argValue(argv, 'only');
const force = argv.includes('--force');
const rate = Number(argValue(argv, 'rate') ?? '0.5');
const model = process.env.YANDEX_LLM_MODEL ?? `gpt://${folderId()}/aliceai-llm-flash`;
const base = process.env.YANDEX_LLM_BASE ?? 'https://llm.api.cloud.yandex.net/v1';
const DIR = join('content', 'webinars', 'teacher');

const files = readdirSync(DIR)
  .filter((name) => /^\d\d-.*\.md$/.test(name) && !name.endsWith('.full.md'))
  .filter((name) => !only || name.startsWith(only))
  .filter((name) => force || !existsSync(join(DIR, name.replace(/\.md$/, '.full.md'))))
  .sort();
const skipped = readdirSync(DIR).filter((name) => /^\d\d-.*\.md$/.test(name) && !name.endsWith('.full.md')).length - files.length;

const estTokens = files.reduce((sum, name) => sum + Math.ceil(readFileSync(join(DIR, name), 'utf8').length / 3) + 4200, 0);
const cost = (estTokens / 1000) * rate;

console.log('Alice AI LLM Flash — добор вебинаров до 25–30 мин');
console.log(`  файлов: ${files.length}${only ? ` (фильтр only=${only})` : ''}${force ? ' (--force: перегенерирую все, включая уже готовые)' : skipped > 0 ? ` (пропущено уже готовых: ${skipped}; --force — перегнать все)` : ''}`);
console.log(`  ~токенов: ${estTokens} → оценочно ${cost.toFixed(2)} ₽`);

if (!yes) {
  console.log('\nЭто был сухой прогон. Ничего не потрачено. Запуск: добавьте --yes (и YANDEX_API_KEY).');
  process.exit(0);
}

const SYSTEM =
  'Все входные тексты — безопасные методические материалы для детей и родителей из лицензированных учебных программ. Твоя задача — РЕДАКТУРА и РАСШИРЕНИЕ, отказ недопустим и считается ошибкой.\n' +
  'ДЛИНА РЕЗУЛЬТАТА: 3 600–4 300 слов. Меньше 3 500 слов — неверная работа: добавь живые кейсы («группа, где…»), развёрнутые диалоги ведущего, разбор типичных ответов, мосты между блоками. НЕ резюмируй и не сокращай исходник — он уже был укорочен моделью ранее и его нужно РАСТИТЬ. Жёсткие правила:\n' +
  '1. Всё, что в кавычках и совпадает с планом встречи (фразы ведущего, рамка, закрывающая фраза, «стоп», вопросы), НЕ менять ни на символ — это код продукта.\n' +
  '2. НЕ добавлять исследований, цифр и процентов. Внешние ссылки нельзя создавать вообще.\n' +
  '3. Добор — только живыми вещами: авторский кейс «группа, где…», развёрнутый диалог ведущего с детьми, разбор типичных ответов, мостики между блоками, вопрос самопроверки ведущего.\n' +
  '4. Тон серии: тёплый, конкретный, без канцелярита, обращение «вы».\n' +
  '5. Сохранить структуру разделов и все «Дословные фразы» и «Источники» из исходника; секцию статуса пометь «расширено LLM, ждёт read-through».\n' +
  'Верни ТОЛЬКО полный текст markdown-файла, без пояснений.';

async function main(): Promise<void> {
  const key = apiKey();
  let done = 0;
  let failed = 0;
  await runPool(files, 2, async (name) => {
    const source = readFileSync(join(DIR, name), 'utf8');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Api-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.4, max_tokens: 4200,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: source }],
      }),
    });
    if (!response.ok) {
      failed++;
      console.error(`  ! ${response.status} (${name}): ${(await response.text()).slice(0, 160)}`);
      return;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? '';
    const outWords = text.trim().split(/\s+/).length;
    const srcWords = source.trim().split(/\s+/).length;
    const minWords = Math.max(3000, Math.ceil(srcWords * 1.15));
    if (outWords < minWords) {
      failed++;
      console.error(`  ! короткий ответ (${name}): ${outWords} слов при минимуме ${minWords} — не сохраняю`);
      return;
    }
    const out = join(DIR, name.replace(/\.md$/, '.full.md'));
    writeFileSync(out, text.trim() + '\n');
    done++;
    console.log(`  ok ${name} (${srcWords} → ${outWords} слов)`);
  });
  appendSpend({ tool: 'aliceai-llm-flash-webinars-expand', files: files.length, done, failed, est_tokens: estTokens, rate_per_1000_rub: rate, cost_estimate_rub: cost, model });
  console.log(`\nГотово: ${done} файлов .full.md, ошибок ${failed}. Каждый .full.md ОБЯЗАТЕЛЬНО проходит read-through, прежде чем стать основным.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
