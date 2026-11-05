/**
 * Отчёт о секретах для дежурного и для сборки.
 *
 *   npm run secrets:check          — человекочитаемый отчёт; код 1, если есть блокеры
 *   npm run secrets:check -- --json — то же машинно
 *
 * Ни одно значение секрета здесь не печатается: только имя, длина, возраст и
 * причина. Иначе отчёт стал бы местом, где секреты утекают в журнал сборки.
 */
import { auditSecrets, clientLeaks, rotationPlan, strictBlockers } from '../lib/secrets.ts';

const json = process.argv.includes('--json');
const audit = auditSecrets();
const leaks = clientLeaks();
const strict = strictBlockers(audit);

if (json) {
  const ready = audit.ready && leaks.length === 0 && strict.length === 0;
  // `ready` вычисляется здесь: у audit он значит «нет блокеров», без утечек и строгого режима.
  console.log(JSON.stringify({ ...audit, ready, clientLeaks: leaks, strict }, null, 2));
} else {
  console.log('Секреты gib\n');
  for (const item of audit.items) {
    const mark = item.status === 'ok' ? 'ok  ' : item.status === 'missing' ? 'НЕТ ' : 'СЛАБ';
    console.log(`  ${mark} ${item.env} (${item.length} симв.) — ${item.note}`);
    console.log(`       ${item.purpose}`);
  }
  if (leaks.length) {
    console.log('\nУтечка в клиентский бандл (NEXT_PUBLIC_*):');
    for (const name of leaks) console.log(`  ОПАСНО ${name} — значение увидит любой пользователь`);
  }
  if (strict.length) {
    console.log('\nСтрогий режим: просроченные секреты не пускают старт');
    for (const name of strict) console.log(`  ПРОСРОЧЕН ${name}`);
  }
  if (audit.warnings.length) {
    console.log('\nПредупреждения:');
    for (const warning of audit.warnings) console.log(`  ! ${warning}`);
  }
  console.log(`\nГотовность: ${audit.ready && leaks.length === 0 && strict.length === 0 ? 'ок' : 'есть блокеры'}`);
  if (audit.ready === false) {
    console.log('\nПорядок ротации ключа резервных копий:');
    for (const step of rotationPlan()) console.log('  ' + step);
  }
}

process.exitCode = audit.ready && leaks.length === 0 && strict.length === 0 ? 0 : 1;
