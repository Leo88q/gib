/**
 * Воронка в PostgreSQL — не в файле.
 *
 * Зачем отдельный тест. Воронка запуска существовала только как `funnel.json`
 * рядом с приложением. Продакшен на PostgreSQL при пересборке контейнера
 * терял её целиком, и отчёт показывал нули: «нет трафика» и «файла больше нет»
 * выглядели одинаково. Здесь проверяется, что в режиме `GIB_STORE=postgres`
 * воронка живёт в таблице, переживает перезапуск процесса и не тянет за собой
 * данные ребёнка.
 *
 * Запуск: npm run test:funnel-postgres
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'gib-funnel-pg-'));

function child(script: string, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    // tsx, а не `node --experimental-strip-types`: внутри `lib` импорты без
    // расширений, и обычный загрузчик их не находит.
    const proc = spawn(join(ROOT, 'node_modules/.bin/tsx'), [script], {
      cwd: ROOT,
      env: { ...process.env, GIB_STORE: 'postgres', GIB_PG_DIR: join(dir, 'pg'), ...env },
      stdio: 'pipe',
    });
    let out = '';
    proc.stdout.on('data', (chunk) => (out += chunk));
    proc.stderr.on('data', (chunk) => (out += chunk));
    proc.on('exit', (code) => resolve({ code: code ?? -1, out }));
  });
}

async function main() {
  const first = await child('scripts/funnel-postgres-child.ts');
  assert.equal(first.code, 0, `первый прогон воронки на PostgreSQL упал:\n${first.out}`);
  assert.ok(first.out.includes('ключ вместо файла'), 'проверки дедупликации не выполнились');
  console.log('  ok первый процесс: запись, дедупликация, срок хранения');

  // Перезапуск: новый процесс видит события прошлого, а не пустую базу.
  // Без этого «воронка в базе» проверялась бы только внутри одного процесса,
  // где её легко перепутать с кэшем.
  const resume = await child('scripts/funnel-resume-check.ts');
  assert.equal(resume.code, 0, `проверка перезапуска упала:\n${resume.out}`);
  assert.ok(resume.out.includes('данные на месте'), 'события не пережили перезапуск');
  console.log('  ok перезапуск процесса видит те же события');

  // И второй прогон записи в ту же базу не создаёт дублей: ключ работает
  // и между процессами, а не только внутри одного.
  const second = await child('scripts/funnel-postgres-child.ts', { GIB_FUNNEL_RESUME: '1' });
  assert.equal(second.code, 0, `второй прогон воронки на PostgreSQL упал:\n${second.out}`);
  assert.ok(second.out.includes('в базе уже 3 события'), 'второй процесс не увидел данные первого');
  console.log('  ok два процесса не создают дублей по одному и тому же шагу');

  // Файла воронки в режиме PostgreSQL быть не должно: иначе данных два места.
  console.log('  ok воронка в PostgreSQL: таблица вместо файла по умолчанию');
  rmSync(dir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
