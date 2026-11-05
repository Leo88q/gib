/**
 * Метрики процесса: только числа, без содержимого.
 *
 * Главное правило: метрика не должна становиться второй базой данных о ребёнке.
 * Здесь нет ни имён, ни идентификаторов профилей, ни чувств, ни ответов, ни
 * initData — только счётчики и суммы, которые нужны, чтобы понять, жив ли
 * сервис и не деградировал ли он.
 *
 * Три вида значений:
 *  - **счётчики** событий (запросы, ошибки, отказы), которые только растут;
 *  - **показатели** на момент времени (память, размеры), которые заменяются;
 *  - **гистограмма** длительности в фиксированных корзинах.
 *
 * Хранение — в памяти процесса и в ограниченном по размеру виде. Метрики не
 * пишутся на диск: после перезапуска они начинаются заново, и это нормально.
 */

/** Корзины длительности в миллисекундах: от «мгновенно» до «явно медленно». */
export const LATENCY_BUCKETS_MS = [5, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

const MAX_LABEL_KEYS = 500;

export type Histogram = {
  buckets: number[];
  /** Количество наблюдений сверх последней корзины. */
  overflow: number;
  count: number;
  sumMs: number;
  maxMs: number;
};

export type Snapshot = {
  startedAt: number;
  uptimeMs: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, Histogram>;
};

function emptyHistogram(): Histogram {
  return { buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0), overflow: 0, count: 0, sumMs: 0, maxMs: 0 };
}

/**
 * Реестр метрик. Один на процесс; потоки не создаёт.
 *
 * Имена метрик строятся из кода приложения, а не из пользовательских данных.
 * Если метка пришла извне, её нужно нормализовать до вызова (whitelist в
 * вызывающем коде), иначе можно случайно создать кардинальность из данных.
 */
export class Metrics {
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();

  private bounded(size: number): boolean {
    return size < MAX_LABEL_KEYS;
  }

  inc(name: string, by = 1): void {
    // Счётчик только растёт: отрицательное приращение — почти всегда ошибка
    // вызывающего, и молчаливое уменьшение скрыло бы её.
    if (!Number.isFinite(by) || by <= 0) return;
    if (!this.counters.has(name)) {
      if (!this.bounded(this.counters.size)) {
        this.drop();
        return;
      }
      this.counters.set(name, 0);
    }
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /**
   * Записывает сам факт отказа от новой метки.
   *
   * Напрямую, а не через inc: вызов inc отсюда дал бы бесконечную рекурсию,
   * когда имя `metrics_dropped_total` тоже не помещается в лимит.
   */
  private drop(): void {
    // Счётчик отказов занимает один слот в пределах лимита: он важнее любой
    // отдельной метрики, иначе переполнение станет невидимым.
    const key = 'metrics_dropped_total';
    const current = this.counters.get(key);
    if (current === undefined && this.counters.size >= MAX_LABEL_KEYS) {
      const evicted = this.counters.keys().next().value as string | undefined;
      if (evicted && evicted !== key) this.counters.delete(evicted);
      else return;
    }
    this.counters.set(key, (current ?? 0) + 1);
  }

  set(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (!this.gauges.has(name) && !this.bounded(this.gauges.size)) {
      this.drop();
      return;
    }
    this.gauges.set(name, value);
  }

  observe(name: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    let histogram = this.histograms.get(name);
    if (!histogram) {
      if (!this.bounded(this.histograms.size)) {
        this.drop();
        return;
      }
      histogram = emptyHistogram();
      this.histograms.set(name, histogram);
    }
    const index = LATENCY_BUCKETS_MS.findIndex(bound => ms <= bound);
    if (index === -1) histogram.overflow += 1;
    else histogram.buckets[index] += 1;
    histogram.count += 1;
    histogram.sumMs += ms;
    if (ms > histogram.maxMs) histogram.maxMs = ms;
  }

  snapshot(): Snapshot {
    const now = Date.now();
    return {
      startedAt: this.startedAt,
      uptimeMs: Math.max(0, now - this.startedAt),
      counters: Object.fromEntries([...this.counters].sort(([a], [b]) => a.localeCompare(b))),
      gauges: Object.fromEntries([...this.gauges].sort(([a], [b]) => a.localeCompare(b))),
      histograms: Object.fromEntries([...this.histograms].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, buckets: [...v.buckets] }])),
    };
  }

  /** Сброс нужен только тестам: между запросами метрики не обнуляются. */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

/** Общий реестр приложения. Тесты создают свой экземпляр. */
export const metrics = new Metrics();

/** Длительность в секундах по корзинам: удобно читать человеком. */
export function histogramSummary(histogram: Histogram): { count: number; avgMs: number; maxMs: number; p95Ms: number | null } {
  // Точных процентилей без хранения всех значений не бывает: отдаём
  // верхнюю границу корзины, в которой накопилось 95% наблюдений.
  const total = histogram.count + histogram.overflow;
  const target = Math.ceil(total * 0.95);
  let seen = 0;
  let p95: number | null = null;
  for (let i = 0; i < histogram.buckets.length; i++) {
    seen += histogram.buckets[i];
    if (seen >= target) { p95 = i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] : null; break; }
  }
  return {
    count: histogram.count,
    avgMs: histogram.count > 0 ? Math.round(histogram.sumMs / histogram.count) : 0,
    maxMs: Math.round(histogram.maxMs),
    p95Ms: p95,
  };
}

/**
 * Формат Prometheus: простой текст, который понимают Prometheus, VictoriaMetrics
 * и Grafana Agent. Без внешних зависимостей и без идентификаторов.
 */
export function toPrometheus(snapshot: Snapshot, prefix = 'gib'): string {
  const lines: string[] = [];
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9_:]/g, '_');
  lines.push('# HELP ' + prefix + '_uptime_seconds Время работы процесса в секундах.');
  lines.push('# TYPE ' + prefix + '_uptime_seconds gauge');
  lines.push(`${prefix}_uptime_seconds ${Math.floor(snapshot.uptimeMs / 1000)}`);
  for (const [name, value] of Object.entries(snapshot.counters)) {
    lines.push(`# TYPE ${prefix}_${safe(name)} counter`);
    lines.push(`${prefix}_${safe(name)} ${value}`);
  }
  for (const [name, value] of Object.entries(snapshot.gauges)) {
    lines.push(`# TYPE ${prefix}_${safe(name)} gauge`);
    lines.push(`${prefix}_${safe(name)} ${value}`);
  }
  for (const [name, histogram] of Object.entries(snapshot.histograms)) {
    const base = `${prefix}_${safe(name)}`;
    lines.push(`# TYPE ${base} histogram`);
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      cumulative += histogram.buckets[i];
      lines.push(`${base}_bucket{le="${LATENCY_BUCKETS_MS[i] / 1000}"} ${cumulative}`);
    }
    cumulative += histogram.overflow;
    lines.push(`${base}_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`${base}_sum ${histogram.sumMs / 1000}`);
    lines.push(`${base}_count ${cumulative}`);
  }
  return lines.join('\n') + '\n';
}
