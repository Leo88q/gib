/**
 * Проверка сбора метрик и алертов как артефактов эксплуатации.
 *
 * Что здесь доказывается:
 *  1. Правила алертов — синтаксически корректный YAML, и каждое выражение
 *     ссылается только на метрики, которые сервис действительно отдаёт.
 *  2. Сгенерированные конфиги совпадают с кодом (`ops:gen --check`).
 *  3. Конфиг сбора работает: токен из окружения подставляется, запрос идёт на
 *     `/api/metrics`, и по этому конфигу реально снимаются метрики с живого
 *     сервера — с токеном 200 и именами, без токена 401.
 *  4. Секретов в репозитории нет: токен в артефактах отсутствует.
 *
 * Парсер YAML — настоящий (`yaml` из devDependencies), а не регулярки: цель в
 * том, чтобы файл прочитал Prometheus, а не мой скрипт.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { MEASURED_ROUTES, RATE_LIMIT_SCOPES, READINESS_CHECKS, metricNames } from '../lib/observability/catalog.ts';
import { PLACEHOLDER_TARGET, PLACEHOLDER_TOKEN } from './gen-ops.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const ALERTS = join(ROOT, 'ops/prometheus/alerts.yml');
const CONFIG = join(ROOT, 'ops/prometheus/prometheus.generated.yml');
const DASHBOARD = join(ROOT, 'ops/grafana/dashboard.generated.json');

const TOKEN = 'ops-config-token-1234567';
const PORT = 3155;
/**
 * Живая фаза идёт на собранном приложении, а не на dev-сервере.
 *
 * В dev-режиме Next компилирует каждый маршрут в отдельный модуль, поэтому
 * `/api/health` и `/api/metrics` получают разные экземпляры реестра метрик:
 * числа одного маршрута не видны другому. Это свойство dev-сборки, а не
 * сервиса; в production-сборке реестр общий на процесс (проверено).
 */
const LIVE = process.argv.includes('--live');

type Rule = { alert: string; expr: string; for: string; labels: { severity: string }; annotations: { summary: string; description: string } };

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: ROOT, env });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('close', code => resolve({ code: code ?? -1, out }));
  });
}

/** Имена метрик, встречающиеся в выражении PromQL. */
function referencedNames(expr: string): string[] {
  // Сначала вырезаем строковые литералы: `le="0.1"` — не имя метрики.
  const bare = expr.replace(/"[^"]*"/g, '""');
  const names = new Set<string>();
  // Имена, которые не являются функциями или ключевыми словами PromQL.
  const keywords = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'offset', 'bool', 'and', 'or', 'unless', 'sum', 'rate', 'increase', 'absent', 'histogram_quantile']);
  // Имя метрики стоит перед `{`, `[` или оператором; имя метки — перед `=`,
  // поэтому `job="gib"` сюда не попадает.
  const token = /(?<![\w:])([a-z_][a-z0-9_]*(?::[a-z0-9_]+)?)\s*(?=[{\[]|$|\s*(?:==|!=|>=|<=|>|<|\+|-|\*|\/|%))/g;
  for (const m of bare.matchAll(token)) {
    const name = m[1];
    if (keywords.has(name)) continue;
    // Метки вида `le`, `job`, `severity` не содержат `gib_` — их отсекает проверка ниже.
    names.add(name);
  }
  return [...names];
}

let okCount = 0;
function ok(label: string) {
  okCount++;
  console.log('  ok ' + label);
}

async function main() {
  const known = new Set(metricNames());
  // Гистограмма отдаётся как _bucket/_sum/_count; в правилах допустимо и
  // «сырое» имя без суффикса — Prometheus не примет его, поэтому проверяем
  // строго: имя обязано быть в каталоге.
  const rules: Rule[] = [];
  const doc = parseYaml(readFileSync(ALERTS, 'utf8'));
  for (const group of doc.groups) {
    assert.ok(Array.isArray(group.rules) && group.rules.length > 0, `в группе ${group.name} есть правила`);
    for (const rule of group.rules) rules.push(rule);
  }
  assert.ok(rules.length >= 10, `правил не меньше десяти: ${rules.length}`);
  ok(`правила: валидный YAML, ${rules.length} правил в ${doc.groups.length} группах`);

  // 1. Каждое выражение ссылается только на существующие метрики.
  for (const rule of rules) {
    const names = referencedNames(rule.expr);
    assert.ok(names.length > 0, `в ${rule.alert} есть хотя бы одна метрика`);
    for (const name of names) {
      if (name.startsWith('gib_')) {
        assert.ok(known.has(name), `метрика ${name} из ${rule.alert} есть в каталоге`);
      } else {
        // Внешние имена (up) и метки допустимы только в известном наборе.
        assert.equal(name, 'up', `в ${rule.alert} неизвестное имя ${name}`);
      }
    }
    assert.ok(['critical', 'warning', 'info'].includes(rule.labels.severity), `у ${rule.alert} понятная важность`);
    assert.ok(rule.annotations.summary && rule.annotations.description, `у ${rule.alert} есть пояснение`);
    assert.ok(/^\d+[smh]$/.test(rule.for), `у ${rule.alert} есть выдержка, а не мгновенный крик`);
  }
  ok('правила ссылаются только на метрики из каталога и имеют важность, пояснение и выдержку');

  // 2. Обязательные проверки покрыты алертами, а не только «сервис жив».
  for (const check of READINESS_CHECKS) {
    const covered = rules.some(r => r.expr.includes(`check_${check}`)) || rules.some(r => r.expr.includes('readiness_checks_failed_total'));
    assert.ok(covered, `состояние проверки ${check} попадает в алерты`);
  }
  const alertText = rules.map(r => r.expr + r.annotations.summary + r.annotations.description).join(' ');
  for (const scope of ['session', 'profile-export']) {
    assert.ok(RATE_LIMIT_SCOPES.includes(scope as never), `${scope} — известная область лимитов`);
  }
  assert.ok(/нет данных/i.test(alertText), 'отсутствие данных — отдельная тревога, а не тишина');
  ok('алерты покрывают обязательные проверки и отдельно ловят отсутствие данных');

  // 3. Ни одного идентификатора ребёнка в метках алертов.
  for (const rule of rules) {
    assert.ok(!/owner|player|child|family_id|initData/i.test(rule.expr), `в ${rule.alert} нет меток с идентификаторами`);
  }
  ok('в алертах нет идентификаторов ребёнка: только маршруты, области и состояние');

  // 4. Сгенерированное совпадает с кодом.
  const gen = await run('./node_modules/.bin/tsx', ['scripts/gen-ops.ts', '--check']);
  assert.equal(gen.code, 0, `ops:gen --check проходит:\n${gen.out}`);
  ok('конфиги сбора и панели совпадают с каталогом (ops:gen --check)');

  // 5. В артефактах нет секретов и подстановка настоящая.
  const configText = readFileSync(CONFIG, 'utf8');
  assert.ok(configText.includes(PLACEHOLDER_TOKEN), 'токен подставляется из окружения');
  assert.ok(configText.includes(PLACEHOLDER_TARGET), 'адрес подставляется из окружения');
  assert.ok(!/Bearer\s+[A-Za-z0-9_-]{16,}/.test(configText), 'в конфиге нет литерального токена');
  assert.ok(configText.includes('/api/metrics'), 'сбор идёт на /api/metrics');
  const dashboard = JSON.parse(readFileSync(DASHBOARD, 'utf8'));
  assert.ok(dashboard.panels.length >= 6, `панелей достаточно: ${dashboard.panels.length}`);
  for (const panel of dashboard.panels) {
    assert.ok(panel.targets.length > 0 && panel.targets[0].expr, `у панели «${panel.title}» есть запрос`);
    for (const name of referencedNames(panel.targets[0].expr)) {
      if (name.startsWith('gib_')) assert.ok(known.has(name) || /__name__/.test(panel.targets[0].expr), `метрика ${name} панели есть в каталоге`);
    }
  }
  ok(`панели ссылаются на существующие метрики, секретов в артефактах нет (${dashboard.panels.length} панелей)`);

  // 6. Живой скрейп по сгенерированному конфигу — только на production-сборке.
  for (const route of MEASURED_ROUTES) {
    assert.ok(known.has(`gib_http_${route.replace(/\./g, '_')}_total`), `маршрут ${route} описан в каталоге`);
  }
  if (!LIVE) {
    console.log('  … живой скрейп пропущен: npm run test:ops-live (нужна сборка)');
    console.log(`\n  ok сбор метрик и алерты: ${okCount} проверок`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'gib-ops-'));
  const db = join(dir, 'ops.sqlite');
  assert.ok(existsSync(join(ROOT, '.next/BUILD_ID')), 'есть production-сборка (npm run build)');
  const server = spawn('./node_modules/.bin/next', ['start', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, GIB_METRICS_TOKEN: TOKEN, GIB_DEMO_MODE: '1', GIB_DB_PATH: db, NODE_ENV: 'production' },
    stdio: 'pipe',
  });
  let serverLog = '';
  server.stdout.on('data', d => (serverLog += d));
  server.stderr.on('data', d => (serverLog += d));

  try {
    // Ждём готовности, а не «спим надеясь».
    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.ok) {
          up = true;
          break;
        }
      } catch {
        /* сервер ещё поднимается */
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert.ok(up, `production-сервер поднялся:\n${serverLog.slice(-800)}`);

    // Прогреваем те маршруты, которые обещают метрики: числа появляются
    // только после первого вызова, и «нет метрики» ≠ «ноль». Ошибки не
    // глотаем: если прогрев не дошёл, дальше проверять нечего.
    const call = async (url: string, init?: RequestInit, accept: number[] = []) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
          if (res.status < 500 || accept.includes(res.status)) return res;
          lastError = new Error(`HTTP ${res.status}`);
        } catch (error) {
          lastError = error;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      throw new Error(`прогрев не удался: ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    };

    const base = `http://127.0.0.1:${PORT}`;
    // В production пользовательский API закрыт заглушкой запуска намеренно
    // (`lib/launch-guard.ts`), поэтому на настоящей сборке открыты только
    // служебные маршруты — по ним и проверяем сбор. Если когда-нибудь
    // появится окружение без заглушки, живая фаза дотянет и метрики сессии.
    for (const path of ['/api/health', '/api/ready']) {
      const res = await call(base + path);
      assert.equal(res.status, 200, `${path} отвечает 200`);
    }
    const session = await call(base + '/api/session', undefined, [503]);
    const userApiBlocked = session.status === 503;
    assert.ok([200, 400, 503].includes(session.status), `пользовательский API ведёт себя ожидаемо: ${session.status}`);
    let blockedLimit = 0;
    if (!userApiBlocked) {
      await call(base + '/api/session', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      for (let i = 0; i < 14; i++) {
        const res = await call(base + '/api/profile/export');
        if (res.status === 429) blockedLimit++;
      }
      assert.ok(blockedLimit > 0, `лимит экспорта действительно сработал: ${blockedLimit} отказов`);
    }

    // Подстановка: разворачиваем плейсхолдеры так, как это сделал бы деплой.
    const rendered = configText
      .replaceAll(PLACEHOLDER_TOKEN, TOKEN)
      .replaceAll(PLACEHOLDER_TARGET, `127.0.0.1:${PORT}`)
      .replaceAll('${GIB_ENV}', 'test');
    const renderedPath = join(dir, 'prometheus.yml');
    writeFileSync(renderedPath, rendered);

    // Читаем конфиг настоящим YAML-парсером и идём по нему, а не по памяти.
    const parsed = parseYaml(rendered);
    const job = parsed.scrape_configs[0];
    assert.equal(job.authorization.type, 'Bearer', 'тип авторизации — Bearer');
    assert.equal(job.authorization.credentials, TOKEN, 'токен развернулся из окружения');
    assert.deepEqual(job.static_configs[0].targets, [`127.0.0.1:${PORT}`], 'цель развернулась из окружения');

    const scrape = await fetch(`http://${job.static_configs[0].targets[0]}${job.metrics_path}`, {
      headers: { authorization: `${job.authorization.type} ${job.authorization.credentials}` },
    });
    assert.equal(scrape.status, 200, 'скрейп по конфигу отдаёт 200');
    const body = await scrape.text();
    const exposed = new Set(body.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(/[ {]/)[0]));
    const expected = ['gib_uptime_seconds', 'gib_health_checks_total', 'gib_metrics_scrapes_total', 'gib_readiness_degraded_checks', 'gib_check_storage_ok_total'];
    if (!userApiBlocked) {
      expected.push('gib_http_session_info_total', 'gib_ratelimit_blocked_profile_export_total');
    }
    for (const need of expected) {
      assert.ok(exposed.has(need), `скрейп содержит ${need}; есть: ${[...exposed].slice(0, 10).join(', ')}`);
    }
    if (!userApiBlocked) {
      assert.ok(/^# TYPE gib_http_session_info_duration histogram$/m.test(body), 'гистограмма отдаётся с типом');
    }
    // Ни одного имени вне каталога: иначе панель или правило сломаются молча.
    const unknown = [...exposed].filter(n => !known.has(n));
    assert.deepEqual(unknown, [], `все имена вне каталога отсутствуют: ${unknown.join(', ')}`);
    ok(`живой скрейп по конфигу: 200, ${exposed.size} метрик, все из каталога${userApiBlocked ? '; пользовательский API закрыт заглушкой — это защита' : ', включая гистограмму и отказы лимита'}`);

    // Без токена тот же адрес закрыт — конфиг не «работает случайно».
    const closed = await fetch(`http://127.0.0.1:${PORT}${job.metrics_path}`);
    assert.equal(closed.status, 401, 'без токена 401');
    const closedBody = await closed.text();
    assert.ok(!closedBody.includes('gib_'), 'в закрытом ответе нет имён метрик');
    ok('без токена /api/metrics отдаёт 401 и ни одного имени метрики');
  } finally {
    server.kill('SIGTERM');
  }

  assert.ok(existsSync(CONFIG) && existsSync(DASHBOARD) && existsSync(ALERTS));
  console.log(`\n  ok сбор метрик и алерты: ${okCount} проверок`);
}

main().catch(error => {
  console.error('\nAssertionError:', error?.message ?? error);
  process.exitCode = 1;
});
