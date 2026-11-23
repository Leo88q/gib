/**
 * Общие хелперы для скриптов Yandex AI Studio.
 *
 * Секреты читаются только из окружения и никогда не печатаются. Скрипты строят
 * экономику до обращения к сети: без флага --yes они делают сухой прогон,
 * считают объём и отвечают стоимостью, а не тратой.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const INK_ROOT = 'content/ink';
export const OUT_DIR = 'out';
export const SPEND_LOG = join(OUT_DIR, 'ai-grant-spend.jsonl');

export function folderId(): string {
  return process.env.YANDEX_FOLDER_ID ?? 'b1g4u6puplb11nlqbjlg';
}

export function apiKey(): string {
  const key = process.env.YANDEX_API_KEY;
  if (!key) {
    throw new Error(
      'Нет YANDEX_API_KEY в окружении. Создайте сервисный аккаунт в Yandex Cloud → AI Studio, ' +
        'выпустите API-ключ и запускайте так: YANDEX_API_KEY=... npx tsx scripts/yandex-tts.ts --yes\n' +
        'Ключ никогда не коммитится и не выводится в лог.',
    );
  }
  // Заголовок Authorization — ByteString: кириллица в переменной даёт мистический
  // «Cannot convert argument to a ByteString». Лучше сказать прямо, что и где не так.
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code > 0x7e || code < 0x21) {
      throw new Error(
        `YANDEX_API_KEY содержит не-ASCII или служебный символ на позиции ${i} — ` +
          'похоже, в переменную попал не ключ (например, русское слово из инструкции). ' +
          'Проверьте без печати ключа: python3 -c "import os; k=os.environ.get(\'YANDEX_API_KEY\',\'\'); print(len(k), any(ord(c)>127 for c in k))". ' +
          'Ожидается «False». Ключ: латиница, цифры и знаки вроде - _ =, без пробелов и кавычек-«ёлочек».',
      );
    }
  }
  return key;
}

export function hasYesFlag(argv: string[]): boolean {
  return argv.includes('--yes');
}

export function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of argv) if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return undefined;
}

/** Рекурсивный обход каталога ink-файлов. */
export function walkInk(dir: string = INK_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkInk(full));
    else if (entry.endsWith('.ink')) out.push(full);
  }
  return out.sort();
}

/**
 * Извлекает из ink-файла произносящиеся строки: реплики и подписи вариантов
 * выбора. Структурные метки (=== knot, -> divert, LIST/VAR и т.п.) отбрасываются.
 */
export function extractUtterances(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const utterances: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(===|INCLUDE|EXTERNAL|VAR |LIST |->|<-|~|\/\/|\{|[A-Z_]+\s*=)/.test(line)) continue;
    let text = line;
    const choice = /^[*+\-]\s*(?:\[(.+)\]|(.+))$/.exec(line);
    if (choice) text = (choice[1] ?? choice[2] ?? '').trim();
    // ink-теги после '#' к смыслу для озвучки не относятся.
    text = text.split('#')[0].trim();
    // Скобки выбора и глонда удалить остаточными символами разметки.
    text = text.replace(/^[\[\]]+|[\[\]]+$/g, '').trim();
    if (!text) continue;
    if (/^[.\s>]+/.test(text)) continue;
    utterances.push(text);
  }
  return utterances;
}

export function utteranceHash(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** Запись строки расхода в журнал. Содержит только объёмы и оценки, без секретов. */
export function appendSpend(entry: Record<string, unknown>): void {
  mkdirSync(dirname(SPEND_LOG), { recursive: true });
  appendFileSync(SPEND_LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/** Простая конкурентность: не больше limit одновременных обещаний. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export function readInk(file: string): string {
  return readFileSync(file, 'utf8');
}
