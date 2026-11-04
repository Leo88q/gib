/**
 * Проверка восстановленной копии перед приёмкой.
 *
 * npm run restore:check -- <restored.sqlite>
 *
 * Ничего не меняет и не подключает: только проверяет файл и печатает план.
 */
import { RESTORE_PLAN, restoreReportText, verifyRestoredFile } from '../lib/restore-plan.ts';

const [fileArg, ...extra] = process.argv.slice(2);
if (!fileArg || extra.length) {
  console.error('Использование: npm run restore:check -- <restored.sqlite>');
  console.error('Шаги восстановления:');
  for (const [i, step] of RESTORE_PLAN.entries()) console.error(`${i + 1}. ${step.title} — ${step.detail}`);
  process.exit(2);
}

const report = verifyRestoredFile(fileArg);
console.log(restoreReportText(report));
process.exit(report.ok ? 0 : 1);
