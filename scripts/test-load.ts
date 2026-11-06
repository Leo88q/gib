/**
 * Нагрузочная проверка: что сервис делает под потолком, а не «работает на демо».
 *
 * Что это НЕ доказывает. Это не бенчмарк продакшена: одна машина, один
 * процесс, синтетические запросы без реальных данных ребёнка. Числа ниже —
 * нижняя граница «не разваливается», а не прогноз нагрузки.
 *
 * Что здесь действительно проверяется:
 *  1. Под конкурентной нагрузкой нет 5xx: сервис отвечает, а не падает.
 *  2. Лимит запросов режет перебор (429) и не мешает остальным владельцам.
 *  3. Память метрик не растёт от числа разных владельцев: кардинальность
 *     ограничена, метки не содержат идентификаторов.
 *  4. После нагрузки сервис продолжает отвечать на служебные вопросы.
 *  5. Смешанная нагрузка (чтение + запись) не приводит к потере профиля.
 *
 * Запуск: npm run test:load  (нужна npm run build)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 3193;
const BASE = `http://127.0.0.1:${PORT}`;
const BOT_TOKEN = '555000111:' + 'L'.repeat(35);
const METRICS_TOKEN = 'load-metrics-token-123456';

/** Потолки подобраны так, чтобы тест не падал на медленной машине и ловил обвал. */
const LIMITS = {
  /** Доля ответов 5xx: сервис не должен падать под нагрузкой вовсе. */
  max5xxRatio: 0,
  /** Доля отказов 429: перебор должен упираться в лимит, а не проходить. */
  min429Ratio: 0.1,
  /** Сколько запросов в секунду минимум выдерживает одна машина. */
  minRps: 15,
  /** Сколько памяти процесс может прибавить за нагрузку, МиБ. */
  maxMemoryGrowthMb: 180,
} as const;

let okCount = 0;
function ok(label: string) {
  okCount++;
  console.log('  ok ' + label);
}

function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

/** Подпись считается один раз на владельца: подпись не должна быть узким местом теста. */
const signedCache = new Map<number, string>();
function telegram(parent: number): Record<string, string> {
  let data = signedCache.get(parent);
  if (!data) {
    data = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'Q' + parent, user: JSON.stringify({ id: parent, first_name: 'Н' }) },
      BOT_TOKEN,
    );
    signedCache.set(parent, data);
  }
  return { 'x-telegram-init-data': data };
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: await res.text() };
}

/** Пул параллельных задач фиксированного размера — без «лавины на 500 сразу». */
async function pool<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Память процесса сервиса, а не теста.
 *
 * `next start` порождает дочерний `next-server`, поэтому ищем потомка по
 * командной строке и читаем его RSS из `/proc`. Если найти не удалось —
 * возвращаем null и честно говорим «не измерено», а не подставляем память
 * тестового клиента вместо сервиса.
 */
function serverRssMb(rootPid: number): number | null {
  const read = (pid: number): { ppid: number; cmd: string; rss: number } | null => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      const ppid = Number(fields[1]);
      // RSS в /proc/<pid>/stat — в страницах (поле 24 -> индекс 21 после comm).
      const rssPages = Number(fields[21]);
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      return { ppid, cmd, rss: (rssPages * 4096) / 1024 / 1024 };
    } catch {
      return null;
    }
  };
  const queue = [rootPid];
  let best: number | null = null;
  while (queue.length) {
    const pid = queue.shift()!;
    const info = read(pid);
    if (!info) continue;
    if (/next-server|next start/.test(info.cmd) || info.rss > 40) best = Math.max(best ?? 0, Math.round(info.rss * 10) / 10);
    // Дочерние процессы ищем по ppid.
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        const child = read(Number(entry));
        if (child?.ppid === pid) queue.push(Number(entry));
      }
    } catch {
      /* нет /proc — значит, не Linux; тогда замер не делаем */
    }
  }
  return best;
}

async function main() {
  assert.ok(existsSync(join(ROOT, '.next/BUILD_ID')), 'нужна production-сборка (npm run build)');
  const dir = mkdtempSync(join(tmpdir(), 'gib-load-'));
  const server = spawn('./node_modules/.bin/next', ['start', '-p', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GIB_SECURITY_TEST: '1',
      GIB_DEMO_MODE: '1',
      GIB_SQLITE_FILE: join(dir, 'load.sqlite'),
      // Счётчики в файле: два «инстанса» не нужны, но общий режим ближе к бою.
      GIB_RATE_LIMIT_STORE: 'sqlite',
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      GIB_METRICS_TOKEN: METRICS_TOKEN,
      GIB_LOG_LEVEL: 'warn',
    },
    stdio: 'pipe',
  });
  let log = '';
  server.stdout.on('data', d => (log += d));
  server.stderr.on('data', d => (log += d));

  try {
    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(BASE + '/api/health')).ok) {
          up = true;
          break;
        }
      } catch {
        /* поднимается */
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert.ok(up, `сервер поднялся:\n${log.slice(-600)}`);

    const metrics = async (): Promise<string> => (await fetch(BASE + '/api/metrics', { headers: { authorization: `Bearer ${METRICS_TOKEN}` } })).text();
    const metricValue = (text: string, name: string): number => {
      const line = text.split('\n').find(l => l.startsWith(name + ' '));
      return line ? Number(line.split(' ')[1]) : 0;
    };

    // 1. Прогрев: мерим после того, как маршруты скомпилированы.
    await call('/api/health');
    await call('/api/ready');
    const rssBefore = serverRssMb(server.pid ?? 0);
    const before = await metrics();
    const parserKeysBefore = metricValue(before, 'gib_metrics_dropped_total');

    // 2. Чтение под нагрузкой: 200 запросов, 20 одновременно, 20 разных взрослых.
    const reads = Array.from({ length: 200 }, (_, i) => () => call('/api/profile', { headers: telegram(8000 + (i % 20)) }));
    const readStart = process.hrtime.bigint();
    const readResults = await pool(reads, 20);
    const readMs = Number(process.hrtime.bigint() - readStart) / 1e6;
    const rps = Math.round((readResults.length / readMs) * 1000 * 10) / 10;
    const statusCount = (status: number) => readResults.filter(r => r.status === status).length;
    const failed5xx = readResults.filter(r => r.status >= 500).length;

    assert.equal(failed5xx, 0, `под нагрузкой нет 5xx (получено ${failed5xx}); тела: ${readResults.filter(r => r.status >= 500).map(r => r.body.slice(0, 80)).join(' | ')}`);
    assert.ok([200, 401, 429].includes(readResults[0].status), `ответ ожидаемого вида: ${readResults[0].status}`);
    // 20 владельцев, лимит 120 на окно — все должны пройти, поэтому 200 и 401 (владелец без профиля — 200).
    assert.equal(statusCount(200), readResults.length, `чтение прошло целиком: 200 — ${statusCount(200)}, 429 — ${statusCount(429)}`);
    assert.ok(rps >= LIMITS.minRps, `пропускная способность не ниже ${LIMITS.minRps} запросов/с: ${rps}`);
    ok(`чтение: ${readResults.length} запросов, ${rps} запросов/с, 20 параллельно, ни одного 5xx`);

    // 3. Перебор одним владельцем упирается в лимит, остальные не страдают.
    const flooder = 9001;
    const flood = Array.from({ length: 160 }, () => () => call('/api/profile/export', { headers: telegram(flooder) }));
    const floodResults = await pool(flood, 12);
    const blockedRatio = floodResults.filter(r => r.status === 429).length / floodResults.length;
    assert.ok(blockedRatio >= LIMITS.min429Ratio, `перебор упирается в 429: ${Math.round(blockedRatio * 100)}%`);
    const innocent = await call('/api/profile', { headers: telegram(9002) });
    assert.equal(innocent.status, 200, 'другой владелец не пострадал от чужого перебора');
    ok(`перебор: ${Math.round(blockedRatio * 100)}% запросов получили 429, соседний владелец не задет`);

    // 4. Запись под нагрузкой: 40 владельцев создают по ребёнку, часть — параллельно.
    const writes = Array.from({ length: 40 }, (_, i) => () =>
      call('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...telegram(9100 + i) },
        body: JSON.stringify({ name: 'Нагрузка' + i, age: 6 + (i % 6) }),
      }),
    );
    const writeResults = await pool(writes, 16);
    assert.equal(writeResults.filter(r => r.status >= 500).length, 0, 'запись без 5xx');
    assert.equal(writeResults.filter(r => r.status === 200).length, 40, `все 40 профилей созданы: ${writeResults.filter(r => r.status === 200).length}`);
    // Профили действительно на месте, а не только «ответ 200».
    const check = await call('/api/profile', { headers: telegram(9100) });
    assert.ok(JSON.parse(check.body).profile?.id, 'профиль после нагрузки читается');
    ok('запись: 40 профилей под нагрузкой, ни одного 5xx, данные на месте');

    // 5. Память и кардинальность: метки метрик не содержат идентификаторов.
    const after = await metrics();
    const parserKeysAfter = metricValue(after, 'gib_metrics_dropped_total');
    const namesInResponse = after.split('\n').filter(l => l.startsWith('gib_')).map(l => l.split(/[ {]/)[0]);
    for (const name of new Set(namesInResponse)) {
      assert.ok(!/\d{4,}/.test(name.replace(/^gib_\d/, '')), `в имени метрики нет идентификаторов: ${name}`);
      assert.ok(!name.includes('9100') && !name.includes('9001'), `идентификатор владельца не попал в метрику: ${name}`);
    }
    assert.ok(new Set(namesInResponse).size < 500, `метрик меньше предела кардинальности: ${new Set(namesInResponse).size}`);
    const droppedGrowth = parserKeysAfter - parserKeysBefore;
    assert.ok(droppedGrowth < 50, `кардинальность не взорвалась: выброшено ${droppedGrowth}`);

    // Трафик вырос втрое, а число имён осталось прежним — значит, метки не из данных.
    const namesBefore = new Set(before.split('\n').filter(l => l.startsWith('gib_')).map(l => l.split(/[ {]/)[0])).size;
    assert.ok(new Set(namesInResponse).size <= namesBefore + 15, `новых имён метрик немного: ${namesBefore} → ${new Set(namesInResponse).size}`);
    ok(`кардинальность: ${new Set(namesInResponse).size} имён метрик, идентификаторов владельцев в них нет, выброшено ${droppedGrowth}`);

    // 6. Память процесса сервиса: прирост за нагрузку, а не абсолют.
    const rssAfter = serverRssMb(server.pid ?? 0);
    if (rssBefore !== null && rssAfter !== null) {
      const growth = Math.round((rssAfter - rssBefore) * 10) / 10;
      assert.ok(growth <= LIMITS.maxMemoryGrowthMb, `прирост памяти ${growth} МиБ не выше ${LIMITS.maxMemoryGrowthMb}`);
      ok(`память сервиса: ${rssBefore} → ${rssAfter} МиБ (прирост ${growth} МиБ за 400 запросов)`);
    } else {
      console.log('  … память сервиса не измерена: /proc недоступен (не Linux)');
    }

    // 7. После нагрузки служебные вопросы отвечают по делу.
    const health = await call('/api/health');
    const ready = await call('/api/ready');
    assert.equal(health.status, 200, 'живость после нагрузки');
    assert.ok([200, 503].includes(ready.status), `готовность отвечает: ${ready.status}`);
    const readyJson = JSON.parse(ready.body);
    assert.ok(Array.isArray(readyJson.checks) && readyJson.checks.length >= 6, 'готовность полная, а не усечённая под нагрузкой');
    const errorTotal = metricValue(after, 'gib_http_session_command_errors_total');
    assert.equal(errorTotal, 0, 'ошибок обработчика за нагрузку нет');
    ok(`после нагрузки: живость 200, готовность ${ready.status}, ${readyJson.checks.length} проверок`);

    console.log(`\n  окно нагрузки: чтение ${rps} запросов/с, ${readResults.length + floodResults.length + writeResults.length} запросов всего`);
  } finally {
    server.kill('SIGTERM');
  }

  console.log(`\n  ok нагрузка: ${okCount} проверок`);
}

main().catch(error => {
  console.error('\nAssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
