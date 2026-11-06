/**
 * Полный игровой флоу на PostgreSQL — не на SQLite.
 *
 * Зачем отдельный тест: это доказательство, что режим `GIB_STORE=postgres`
 * действительно работает, а не «включается». Тот же `store`, те же функции
 * движка, но данные лежат в PostgreSQL.
 *
 * Что проверяется:
 *  1. Схема поднимается сама, повторный запуск её не ломает.
 *  2. Создание профиля, сессии, ответы, награды — всё сохраняется и читается.
 *  3. Транзакция откатывается целиком: ошибка не оставляет половину записи.
 *  4. Перезапуск процесса видит те же данные (реальная запись, а не кэш).
 *  5. Удаление профиля чистит связанные записи и журнал.
 *  6. Данные SQLite и PostgreSQL не смешиваются: режим один.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'gib-pg-mode-'));

let okCount = 0;
const ok = (label: string) => {
  okCount++;
  console.log('  ok ' + label);
};

/** Запуск дочернего процесса с PostgreSQL-режимом. */
function child(script: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    // tsx, а не `node --experimental-strip-types`: внутри lib импорты без
    // расширений (`./task-feedback`), и обычный загрузчик Node их не находит.
    const proc = spawn(join(ROOT, 'node_modules/.bin/tsx'), [script], {
      cwd: ROOT,
      env: { ...process.env, GIB_STORE: 'postgres', GIB_PG_DIR: join(dir, 'pg'), ...env },
      stdio: 'pipe',
    });
    let out = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (out += d));
    proc.on('exit', code => resolve({ code: code ?? -1, out }));
  });
}

async function main() {
  // 1. Полный флоу: профиль → программа → сессия → ответ → награда.
  const flow = await child('scripts/pg-mode-flow-child.ts');
  assert.equal(flow.code, 0, `флоу на PostgreSQL прошёл:\n${flow.out.slice(-1500)}`);
  for (const line of flow.out.split('\n').filter(l => l.startsWith('  ok '))) {
    console.log(line);
    okCount++;
  }

  // 2. Перезапуск: новый процесс видит записанное предыдущим.
  const restart = await child('scripts/pg-mode-restart-child.ts');
  assert.equal(restart.code, 0, `данные пережили перезапуск:\n${restart.out.slice(-1200)}`);
  for (const line of restart.out.split('\n').filter(l => l.startsWith('  ok '))) {
    console.log(line);
    okCount++;
  }

  // 3. Чужой режим не может открыть ту же базу как SQLite: файла нет вовсе.
  // На живом сервере каталога данных нет по определению — проверяем только
  // встроенный режим, где каталог и есть база.
  const { existsSync } = await import('node:fs');
  if (!process.env.GIB_POSTGRES_URL) {
    assert.equal(existsSync(join(dir, 'pg')), true, 'данные PostgreSQL лежат в своём каталоге');
  } else {
    assert.equal(existsSync(join(dir, 'pg')), false, 'на живом сервере локального каталога нет');
  }

  console.log(`\n  ok PostgreSQL как хранилище: ${okCount} проверок`);
}

main()
  .catch(error => {
    console.error('\nAssertionError:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
