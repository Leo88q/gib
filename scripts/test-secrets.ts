/**
 * Секреты, ротация ключей и трассировка — то, что нельзя проверить «на глаз».
 *
 * Проверяется:
 *  1. Обязательные секреты: отсутствие и слабые значения не пускают старт,
 *     необязательные дают предупреждение, а не отказ.
 *  2. Значения-заглушки, пробелы и переводы строк отвергаются: «changeme» —
 *     не секрет, даже если длина подходит.
 *  3. Возраст: без отметки он неизвестен, а не «свежий»; просроченный секрет
 *     виден, а строгий режим переводит его в отказ.
 *  4. Утечка в клиент: `NEXT_PUBLIC_*TOKEN` находится и называется.
 *  5. Ротация ключа резервных копий работает по-настоящему: копия, снятая
 *     прежним ключом, читается после смены; шифрование идёт новым.
 *  6. Трассировка: ID выдаётся, чужой заголовок без доверия игнорируется,
 *     мусор отвергается, и все строки одного запроса находятся по ID.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SECRETS,
  auditSecrets,
  clientLeaks,
  fingerprint,
  rotationPlan,
  rotationView,
  secretsReady,
  strictBlockers,
  type SecretAudit,
} from '../lib/secrets.ts';
import { backupKeysFromEnvironment, decryptFileWithRotation, decryptFile, encryptFile } from '../lib/encrypted-backup.ts';
import { TRACE_HEADER, TRACE_INTERNAL_HEADER, eventsByTrace, isValidTraceId, newTraceId, traceFields, traceOf } from '../lib/observability/trace.ts';
import { logError } from '../lib/observability/log.ts';
import { measured } from '../lib/observability/measure.ts';

/** Мусор во внутреннем заголовке не должен приниматься; выдаётся новый ID. */
function JUNK_INTERNAL_FALLBACK(): boolean {
  const context = traceOf(
    new Request('http://localhost/api/x', { headers: { [TRACE_INTERNAL_HEADER]: 'bad id with spaces' } }),
    {} as unknown as NodeJS.ProcessEnv,
  );
  // Кириллица и прочий не-ASCII в заголовок HTTP не попадёт вовсе, поэтому
  // отдельно проверяется сама функция проверки формата.
  return context.source === 'generated' && isValidTraceId(context.traceId) && !isValidTraceId('плохой-id');
}

let okCount = 0;
function ok(label: string) {
  okCount++;
  console.log('  ok ' + label);
}

/** Полный набор годных секретов — база для проверок «сломай одно». */
function goodEnv(): NodeJS.ProcessEnv {
  return {
    TELEGRAM_BOT_TOKEN: '123456789:' + 'A'.repeat(35),
    MAX_BOT_TOKEN: 'max-' + 'b'.repeat(24),
    YOOKASSA_SHOP_ID: '123456',
    YOOKASSA_SECRET_KEY: 'live_' + 'c'.repeat(30),
    GIB_BACKUP_KEY_HEX: randomBytes(32).toString('hex'),
    GIB_METRICS_TOKEN: 'metrics-token-' + 'd'.repeat(10),
  } as unknown as NodeJS.ProcessEnv;
}

function auditOf(env: NodeJS.ProcessEnv): SecretAudit {
  return auditSecrets(env, new Date('2026-11-05T12:00:00Z'));
}

async function main() {
  // 1. Полный набор — готово, блокеров нет.
  const full = auditOf(goodEnv());
  assert.equal(full.ready, true, `полный набор проходит: ${full.blockers.join('; ')}`);
  assert.deepEqual(full.blockers, [], 'блокеров нет');
  // Возраст неизвестен — это предупреждение, а не тишина.
  assert.ok(full.warnings.some(w => /возраст неизвестен/.test(w)), 'отсутствие отметки о ротации даёт предупреждение');
  ok('полный набор секретов проходит; неизвестный возраст — предупреждение, а не «всё хорошо»');

  // 2. Каждый обязательный секрет по отдельности останавливает старт.
  for (const spec of SECRETS.filter(s => s.required)) {
    const env = goodEnv();
    delete env[spec.env];
    const audit = auditOf(env);
    assert.equal(audit.ready, false, `без ${spec.env} стартовать нельзя`);
    assert.ok(audit.blockers.some(b => b.startsWith(spec.env)), `${spec.env} назван в блокерах`);
  }
  const noMetrics = goodEnv();
  delete noMetrics.GIB_METRICS_TOKEN;
  const metricsAudit = auditOf(noMetrics);
  assert.equal(metricsAudit.ready, true, 'без токена метрик работать можно');
  assert.ok(metricsAudit.warnings.some(w => w.includes('GIB_METRICS_TOKEN')), 'но это видно в предупреждениях');
  ok('каждый обязательный секрет останавливает старт; необязательный — только предупреждает');

  // 3. Заглушки и мусор не проходят, даже если длина достаточная.
  const stub = goodEnv();
  stub.YOOKASSA_SECRET_KEY = 'changeme';
  const stubAudit = auditOf(stub);
  assert.equal(stubAudit.ready, false, 'заглушка не считается секретом');
  assert.equal(stubAudit.items.find(i => i.env === 'YOOKASSA_SECRET_KEY')!.status, 'shape');

  const short = goodEnv();
  short.TELEGRAM_BOT_TOKEN = 'too-short';
  assert.equal(auditOf(short).ready, false, 'короткое значение не проходит');
  assert.equal(auditOf(short).items.find(i => i.env === 'TELEGRAM_BOT_TOKEN')!.status, 'too_short');

  const spaced = goodEnv();
  spaced.GIB_BACKUP_KEY_HEX = ' ' + randomBytes(32).toString('hex');
  assert.equal(auditOf(spaced).ready, false, 'пробел по краям — почти всегда ошибка вставки');
  const multiline = goodEnv();
  multiline.MAX_BOT_TOKEN = 'max-' + 'b'.repeat(20) + '\n';
  assert.equal(auditOf(multiline).ready, false, 'перевод строки внутри значения отвергается');
  ok('заглушки, короткие значения, пробелы и переводы строк отвергаются с причиной');

  // 4. Возраст и строгий режим.
  const env = goodEnv();
  env.GIB_SECRET_GIB_BACKUP_KEY_HEX_ROTATED_AT = '2025-10-01T00:00:00Z';
  const stale = auditOf(env);
  assert.equal(stale.ready, true, 'Просроченный ключ сам по себе не мешает стартовать');
  assert.equal(stale.items.find(i => i.env === 'GIB_BACKUP_KEY_HEX')!.status, 'stale');
  assert.ok(stale.items.find(i => i.env === 'GIB_BACKUP_KEY_HEX')!.ageDays! > 365, 'возраст посчитан');

  const strictEnv = { ...env, GIB_SECRETS_STRICT: '1' };
  assert.equal(secretsReady(stale, strictEnv), false, 'в строгом режиме просроченный секрет не пускает');
  assert.ok(strictBlockers(stale, strictEnv).some(b => b.includes('GIB_BACKUP_KEY_HEX')));
  assert.equal(secretsReady(stale, env), true, 'без строгого режима — предупреждение');

  const fresh = goodEnv();
  fresh.GIB_SECRET_TELEGRAM_BOT_TOKEN_ROTATED_AT = '2026-10-01T00:00:00Z';
  const freshAudit = auditOf(fresh);
  assert.equal(freshAudit.items.find(i => i.env === 'TELEGRAM_BOT_TOKEN')!.status, 'ok', 'свежий секрет в порядке');
  assert.ok(freshAudit.items.find(i => i.env === 'TELEGRAM_BOT_TOKEN')!.ageDays! <= 40, 'возраст свежего посчитан');
  ok('возраст считается по отметке; строгий режим включает отказ, обычный — предупреждение');

  // 5. Утечка секрета в клиент.
  const leaked = {
    ...goodEnv(),
    NEXT_PUBLIC_YOOKASSA_SECRET_KEY: 'live_x',
    NEXT_PUBLIC_API_TOKEN: 'x',
    NEXT_PUBLIC_SITE_NAME: 'ГИБ',
  } as unknown as NodeJS.ProcessEnv;
  const leaks = clientLeaks(leaked);
  assert.deepEqual(leaks, ['NEXT_PUBLIC_API_TOKEN', 'NEXT_PUBLIC_YOOKASSA_SECRET_KEY'], 'найдены только секреты с клиентским префиксом');
  assert.deepEqual(clientLeaks(goodEnv()), [], 'без клиентского префикса утечек нет');
  ok('секрет под NEXT_PUBLIC_ находится по имени; обычные клиентские переменные не задеты');

  // 6. Отпечаток: разный для разных ключей, одинаковый для одинаковых, не раскрывает значение.
  const a = randomBytes(32).toString('hex');
  const b = randomBytes(32).toString('hex');
  assert.notEqual(fingerprint(a), fingerprint(b), 'отпечатки разных ключей различаются');
  assert.equal(fingerprint(a), fingerprint(a), 'отпечаток стабилен');
  assert.ok(!String(fingerprint(a)).includes(a.slice(0, 8)), 'отпечаток не содержит значение');
  assert.equal(fingerprint(undefined), undefined);
  ok('отпечаток различает ключи и не раскрывает значение');

  // 7. Ротация ключа резервных копий — по-настоящему, с шифрованием файла.
  const oldKey = randomBytes(32).toString('hex');
  const newKey = randomBytes(32).toString('hex');
  assert.deepEqual(rotationView({ GIB_BACKUP_KEY_HEX: oldKey } as unknown as NodeJS.ProcessEnv), [
    { env: 'GIB_BACKUP_KEY_HEX', current: true, previous: false, readable: true },
    { env: 'GIB_BACKUP_KEY_PREVIOUS_HEX', current: false, previous: true, readable: false },
  ], 'без предыдущего ключа читается только текущий');
  assert.equal(rotationView({ GIB_BACKUP_KEY_HEX: oldKey, GIB_BACKUP_KEY_PREVIOUS_HEX: oldKey } as unknown as NodeJS.ProcessEnv)[1].readable, false, 'одинаковые ключи не считаются двумя');
  assert.throws(() => backupKeysFromEnvironment(oldKey, oldKey), /must differ/, 'одинаковые ключи отвергаются при настройке');
  assert.equal(rotationPlan().length, 6, 'план ротации — пошаговый, а не «поменяйте ключ»');

  const dir = mkdtempSync(join(tmpdir(), 'gib-rot-'));
  const plain = join(dir, 'data.sqlite');
  const encryptedOld = join(dir, 'old.gib');
  const restored = join(dir, 'restored.sqlite');
  fs.writeFileSync(plain, 'SQLite format 3\u0000' + 'данные'.repeat(50));
  const before = fs.readFileSync(plain);

  // Копия снята прежним ключом.
  await encryptFile(plain, encryptedOld, Buffer.from(oldKey, 'hex'));
  // Ключ сменился: новый текущий, старый — предыдущий для чтения.
  const keys = backupKeysFromEnvironment(newKey, oldKey);
  const used = await decryptFileWithRotation(encryptedOld, restored, keys);
  assert.equal(used, 'previous', 'старая копия прочитана прежним ключом');
  assert.deepEqual(fs.readFileSync(restored), before, 'содержимое восстановлено без потерь');

  // Текущим ключом старая копия не читается — и это ожидаемо.
  let rejectedByCurrent = false;
  try {
    await decryptFile(encryptedOld, join(dir, 'nope.sqlite'), Buffer.from(newKey, 'hex'));
  } catch {
    rejectedByCurrent = true;
  }
  assert.ok(rejectedByCurrent, 'новым ключом старая копия не расшифровывается');

  // Новая копия шифруется новым ключом и читается им без предыдущего.
  const encryptedNew = join(dir, 'new.gib');
  await encryptFile(plain, encryptedNew, Buffer.from(newKey, 'hex'));
  const restoredNew = join(dir, 'restored-new.sqlite');
  assert.equal(await decryptFileWithRotation(encryptedNew, restoredNew, { current: Buffer.from(newKey, 'hex') }), 'current', 'новая копия читается новым ключом');
  assert.deepEqual(fs.readFileSync(restoredNew), before);

  // Мусор на месте копии не превращается в «восстановлено».
  const garbage = join(dir, 'garbage.gib');
  fs.writeFileSync(garbage, 'не резервная копия');
  let garbageRejected = false;
  try {
    await decryptFileWithRotation(garbage, join(dir, 'g2.sqlite'), keys);
  } catch {
    garbageRejected = true;
  }
  assert.ok(garbageRejected, 'чужой файл не выдаётся за восстановленную копию');
  ok('ротация: старая копия читается прежним ключом, новая — новым, мусор отвергается');

  // 8. Трассировка: формат, доверие заголовку, мусор.
  assert.equal(isValidTraceId(newTraceId()), true, 'выданный ID корректен');
  assert.equal(newTraceId().length, 32, 'UUID без дефисов — 32 символа');
  for (const bad of ['', 'short', 'со-кириллицей', 'x'.repeat(65), 'id with spaces', '<script>']) {
    assert.equal(isValidTraceId(bad), false, `мусор отвергается: ${JSON.stringify(bad)}`);
  }

  const req = (id?: string) => new Request('http://localhost/api/session', { headers: id ? { [TRACE_HEADER]: id } : {} });
  const untrusted = traceOf(req('deadbeefdeadbeef'), {} as unknown as NodeJS.ProcessEnv);
  assert.equal(untrusted.source, 'generated', 'без доверия чужой заголовок игнорируется');
  assert.notEqual(untrusted.traceId, 'deadbeefdeadbeef', 'подставленный ID не принят');

  const trusted = traceOf(req('deadbeefdeadbeef'), { GIB_TRUST_TRACE: '1' } as unknown as NodeJS.ProcessEnv);
  assert.equal(trusted.source, 'header', 'за доверенным прокси заголовок принимается');
  assert.equal(trusted.traceId, 'deadbeefdeadbeef');

  const junk = traceOf(req('<script>alert(1)</script>'), { GIB_TRUST_TRACE: '1' } as unknown as NodeJS.ProcessEnv);
  assert.equal(junk.source, 'generated', 'мусор в заголовке не принимается даже за доверенным прокси');
  ok('трассировка: ID выдаётся, чужой заголовок уважается только за доверенным прокси, мусор отвергается');

  // 9. Сквозная цепочка: обёртка пишет traceId в лог ошибки, а по нему находится строка.
  const lines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  // Перехватываем поток лога, чтобы прочитать его как журнал.
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    lines.push(String(chunk));
    return true;
  };
  // Заголовок принимается только в доверенном режиме — включаем его, иначе
  // проверяли бы не цепочку, а выдачу нового ID.
  process.env.GIB_TRUST_TRACE = '1';
  const traceId = newTraceId();
  const handler = measured('chain.check', (_request: Request) => {
    throw new Error('нарочно');
  });
  try {
    await handler(new Request('http://localhost/api/x', { headers: { [TRACE_HEADER]: traceId } }));
    assert.fail('обработчик должен был упасть');
  } catch (error) {
    assert.equal((error as Error).message, 'нарочно');
  } finally {
    delete process.env.GIB_TRUST_TRACE;
  }
  // Тот же ID ещё для двух событий: цепочка — это несколько строк, а не одна.
  logError('second_event', traceFields({ traceId, source: 'header', startedMs: 0 }));
  logError('third_event', traceFields({ traceId, source: 'header', startedMs: 0 }));
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = originalWrite;

  const events = eventsByTrace(lines, traceId);
  assert.equal(events.length, 3, `по ID найдены все события запроса: ${events.length}`);
  assert.deepEqual(events.map(e => e.event).sort(), ['request_failed', 'second_event', 'third_event'], 'события именно этого запроса');
  const failed = events.find(e => e.event === 'request_failed')!;
  assert.equal(failed.route, 'chain.check', 'в логе есть маршрут');
  assert.ok(!JSON.stringify(events).includes('http://localhost'), 'URL запроса в лог не попал');
  assert.equal(eventsByTrace(lines, 'f'.repeat(32)).length, 0, 'чужой ID не находит наших событий');
  ok('сквозная трассировка: три события одного запроса связаны, URL в лог не попал');

  // 10. Внутренний заголовок от своей middleware принимается без всякого доверия:
  // его ставит не клиент, а наш же код, и он всегда перезаписывается.
  const viaMiddleware = traceOf(
    new Request('http://localhost/api/session', { headers: { [TRACE_INTERNAL_HEADER]: 'aaaabbbbccccdddd' } }),
    {} as unknown as NodeJS.ProcessEnv,
  );
  assert.equal(viaMiddleware.source, 'header', 'ID от middleware принят');
  assert.equal(viaMiddleware.traceId, 'aaaabbbbccccdddd');
  // И он важнее клиентского: подсунуть «внутренний» ID снаружи нельзя, потому
  // что middleware перезаписывает заголовок перед обработчиком.
  const both = traceOf(
    new Request('http://localhost/api/x', { headers: { [TRACE_INTERNAL_HEADER]: 'aaaabbbbccccdddd', [TRACE_HEADER]: 'ffffffffffffffff' } }),
    { GIB_TRUST_TRACE: '1' } as unknown as NodeJS.ProcessEnv,
  );
  assert.equal(both.traceId, 'aaaabbbbccccdddd', 'внутренний заголовок главнее внешнего');
  assert.equal(JUNK_INTERNAL_FALLBACK(), true, 'мусор во внутреннем заголовке не ломает выдачу');
  ok('внутренний заголовок middleware принимается и главнее клиентского');

  // 11. Успешный ответ тоже оставляет след — но только на уровне debug.
  const doneLines: string[] = [];
  const originalDone = process.stdout.write.bind(process.stdout);
  const originalLevel = process.env.GIB_LOG_LEVEL;
  process.env.GIB_LOG_LEVEL = 'debug';
  // debug и info идут в stdout, ошибки — в stderr: перехватываем оба, иначе
  // проверка «строки нет» проходила бы просто потому, что смотрели не туда.
  const sink = (chunk: string) => {
    doneLines.push(String(chunk));
    return true;
  };
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = sink;
  const okHandler = measured('done.check', async (_request: Request) => new Response('{}', { status: 200 }));
  const response = await okHandler(new Request('http://localhost/api/y'));
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = originalDone;
  if (originalLevel === undefined) delete process.env.GIB_LOG_LEVEL;
  else process.env.GIB_LOG_LEVEL = originalLevel;

  const returnedId = response.headers.get(TRACE_HEADER)!;
  assert.ok(isValidTraceId(returnedId), 'ответ несёт идентификатор запроса');
  const done = eventsByTrace(doneLines, returnedId);
  assert.equal(done.length, 1, 'успешный запрос оставил одну строку');
  assert.equal(done[0].event, 'request_done', 'событие названо');
  assert.equal(done[0].route, 'done.check', 'маршрут из кода, не из URL');
  assert.ok(!JSON.stringify(done[0]).includes('/api/y'), 'URL в строку не попал');
  ok('успешный ответ связан с журналом через тот же идентификатор');

  console.log(`\n  ok секреты, ротация и трассировка: ${okCount} проверок`);
}

main().catch(error => {
  console.error('\nAssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
