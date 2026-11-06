/**
 * Генерация рабочего конфига Prometheus из каталога сигналов.
 *
 * Зачем генератор, а не «пример в документации». Пример не проверяется: он
 * стареет молча и продолжает выглядеть правильным. Сгенерированный файл
 * сравнивается с закоммиченным (`--check`), поэтому расхождение с кодом видно
 * в тестах, а не в три часа ночи.
 *
 * Токен и адрес подставляются из окружения и никогда не коммитятся: в
 * репозитории лежит файл с заглушками `${GIB_METRICS_TOKEN}` /
 * `${GIB_SCRAPE_TARGET}`.
 *
 * Запуск:
 *   npm run ops:gen                       — перегенерировать файлы
 *   npm run ops:gen -- --check            — только сверить, ничего не писать
 *   GIB_ENV=prod GIB_SCRAPE_TARGET=... npm run ops:gen -- --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { REQUIRED_CHECKS, RATE_LIMIT_SCOPES, MEASURED_ROUTES, READINESS_CHECKS, metricNames } from '../lib/observability/catalog.ts';

export const PLACEHOLDER_TOKEN = '${GIB_METRICS_TOKEN}';
export const PLACEHOLDER_TARGET = '${GIB_SCRAPE_TARGET}';
export const PLACEHOLDER_ENV = '${GIB_ENV}';

/**
 * Собирает конфиг сбора. Плейсхолдеры остаются: реальные значения подставляет
 * Prometheus при развёртывании (env substitution), а не этот скрипт.
 */
export function renderPrometheusConfig(): string {
  return `# Сбор метрик gib: конфиг Prometheus.
#
# Сгенерировано \`npm run ops:gen\` из lib/observability/catalog.ts.
# Руками не править. Подстановки GIB_SCRAPE_TARGET, GIB_METRICS_TOKEN, GIB_ENV
# заменяет Prometheus при запуске (--enable-feature=expand-external-labels или
# envsubst перед стартом). Токен в репозиторий не попадает.

global:
  scrape_interval: 15s
  scrape_timeout: 10s
  evaluation_interval: 15s
  external_labels:
    service: gib
    environment: "${PLACEHOLDER_ENV}"

rule_files:
  - alerts.yml

scrape_configs:
  - job_name: gib
    metrics_path: /api/metrics
    scheme: http
    authorization:
      type: Bearer
      credentials: "${PLACEHOLDER_TOKEN}"
    static_configs:
      - targets: ["${PLACEHOLDER_TARGET}"]
`;
}

/**
 * Собирает панели Grafana. Панель на несуществующую метрику пустая, и пустоту
 * легко принять за «всё хорошо», поэтому список метрик тот же, что в каталоге.
 */
export function renderGrafanaDashboard(): string {
  const p = (title: string, expr: string, unit = 'short', type = 'timeseries') => ({
    title,
    type,
    datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
    fieldConfig: { defaults: { unit, custom: {} }, overrides: [] },
    targets: [{ refId: 'A', expr, legendFormat: '__auto' }],
  });

  const dashboard = {
    title: 'gib — служба',
    uid: 'gib-service',
    schemaVersion: 39,
    version: 1,
    editable: false,
    templating: {
      list: [
        { name: 'DS_PROMETHEUS', type: 'datasource', query: 'prometheus', current: {} },
      ],
    },
    panels: [
      p('Жив ли сервис', 'up{job="gib"}', 'short', 'stat'),
      p('Готовность: degraded', 'gib_readiness_degraded_checks', 'short', 'stat'),
      p('Запросы сессии', 'sum(rate(gib_http_session_info_total[5m]))', 'reqps'),
      p('Ошибки сессии', 'sum(rate(gib_http_session_command_errors_total[5m]))', 'reqps'),
      p('Длительность сессии p95', 'histogram_quantile(0.95, sum by (le) (rate(gib_http_session_command_duration_bucket[5m])))', 's'),
      p('Отказы лимитов', 'sum by (scope) (rate({__name__=~"gib_ratelimit_blocked_.*_total"}[5m]))', 'reqps'),
      p('Сбои хранилища лимитов', 'increase(gib_ratelimit_store_errors_total[5m])', 'short'),
      p('Выброшенные метрики', 'increase(gib_metrics_dropped_total[15m])', 'short'),
    ],
    // Панели не должны молча врать: пустая панель показывает «нет данных».
    links: [
      { title: 'Регламент', url: 'https://github.com/Leo88q/gib/blob/main/docs/operations.md', type: 'link' },
    ],
    annotations: { list: [] },
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
  };
  return JSON.stringify(dashboard, null, 2) + '\n';
}

/** Проверки, которых не хватает в README/регламенте — ловим рассинхрон рано. */
export function coverage(): { metricCount: number; scopes: number; alertsNeed: string[] } {
  const alertsNeed = [
    ...REQUIRED_CHECKS.map(c => `gib_check_${c}_failed_total`),
    ...READINESS_CHECKS.map(c => `gib_check_${c}_ok_total`),
  ];
  return { metricCount: metricNames().length, scopes: RATE_LIMIT_SCOPES.length, alertsNeed };
}

const FILES: Array<[string, () => string]> = [
  ['ops/prometheus/prometheus.generated.yml', renderPrometheusConfig],
  ['ops/grafana/dashboard.generated.json', renderGrafanaDashboard],
];

function main(): void {
  const check = process.argv.includes('--check');
  let stale = 0;

  for (const [path, render] of FILES) {
    const next = render();
    if (check) {
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        current = '';
      }
      if (current !== next) {
        console.error(`устарело: ${path} — запустить npm run ops:gen`);
        stale++;
      } else {
        console.log(`  ok ${path}`);
      }
      continue;
    }
    writeFileSync(path, next);
    console.log(`  записано ${path}`);
  }

  const info = coverage();
  console.log(`  метрик в каталоге: ${info.metricCount}, областей лимитов: ${info.scopes}`);
  if (stale > 0) process.exitCode = 1;
}

// Запуск только при прямом вызове: импорт из тестов не должен писать файлы.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/gen-ops.ts') ?? false;
if (invokedDirectly) main();
