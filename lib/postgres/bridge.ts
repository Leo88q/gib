/**
 * Синхронный доступ к PostgreSQL из приложения, написанного синхронно.
 *
 * Зачем мост, а не переписывание. Всё игровое ядро (`lib/engine/`, `lib/billing.ts`,
 * маршруты) вызывает `store` **синхронно**, и это не случайность: транзакция
 * хранилища оборачивает вычисление наград, запись сессии и запись события так,
 * чтобы «прогресс без события» не появлялся. Сетевой клиент асинхронен, и
 * переписать на `async` пришлось бы почти весь код и все 29 тестов движка —
 * с высоким риском тихо изменить поведение игры.
 *
 * Поэтому PostgreSQL работает в отдельном потоке (worker_threads), а главный
 * поток ждёт ответа через `Atomics.wait`. Это **честная блокировка**: пока идёт
 * запрос, процесс занят им и не обрабатывает другие запросы. Для одного
 * сервиса с SQLite-нагрузкой это нормально; для высокой конкурентности нужен
 * асинхронный клиент, и это записано в регламенте как ограничение, а не
 * выдано за решение.
 *
 * Что здесь важнее всего: ошибка базы данных не превращается в молчаливую
 * пустоту. Любой сбой моста бросает исключение, транзакция откатывается.
 */
import { Worker } from 'node:worker_threads';

/** Размер общей области ответа: строка состояния (16 байт) + JSON. */
const CONTROL_BYTES = 16;
const DEFAULT_BODY_BYTES = 16 * 1024 * 1024;

export type PgRow = Record<string, unknown>;
export type BridgeOptions = {
  /** Строка подключения `postgres://…`. Если не задана — встроенный PGlite. */
  connectionString?: string;
  /** Каталог данных PGlite (только когда нет строки подключения). */
  dataDir?: string;
  /** Сколько ждать ответа базы, мс. */
  timeoutMs?: number;
};

/**
 * Состояние в общей памяти.
 *  [0] — 0 ждём, 1 готово, 2 ошибка;
 *  [1] — длина JSON-ответа;
 *  [2], [3] — резерв (не используются).
 */
export class PgBridge {
  private readonly worker: Worker;
  private readonly control: Int32Array;
  private readonly body: Uint8Array;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly timeoutMs: number;
  private closed = false;
  /** Растёт при каждом обмене: позволяет отличить свой ответ от прошлого. */
  private sequence = 0;
  private lastSeen = 0;

  constructor(options: BridgeOptions) {
    const sab = new SharedArrayBuffer(CONTROL_BYTES + DEFAULT_BODY_BYTES);
    this.control = new Int32Array(sab, 0, 4);
    this.body = new Uint8Array(sab, CONTROL_BYTES);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.worker = new Worker(new URL('../../scripts/pg-bridge-worker.mjs', import.meta.url), {
      workerData: {
        sab,
        connectionString: options.connectionString,
        dataDir: options.dataDir,
      },
    });
    // Поток базы не держит процесс живым: иначе скрипт или тест не завершится,
    // хотя работа уже сделана. Сервер живёт по своим правилам, а не по этому.
    this.worker.unref();
    // Ошибка воркера не должна теряться: она всплывёт при следующем запросе.
    this.worker.on('error', error => {
      this.control[0] = 2;
      Atomics.store(this.control, 1, this.writeError(String(error?.message ?? error)));
      Atomics.notify(this.control, 0);
    });
  }

  private writeError(message: string): number {
    const bytes = this.encoder.encode(message);
    this.body.set(bytes.subarray(0, this.body.length));
    return Math.min(bytes.length, this.body.length);
  }

  /** Один синхронный обмен с базой. */
  private exchange(message: Record<string, unknown>): PgRow[] {
    if (this.closed) throw new Error('PostgreSQL bridge is closed');
    const sequence = ++this.sequence;
    Atomics.store(this.control, 0, 0);
    Atomics.store(this.control, 1, 0);
    this.worker.postMessage({ ...message, sequence });

    const deadline = Date.now() + this.timeoutMs;
    let state = 0;
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`PostgreSQL bridge timeout after ${this.timeoutMs}ms`);
      Atomics.wait(this.control, 0, 0, remaining);
      state = Atomics.load(this.control, 0);
      if (state !== 0) break;
    }
    const length = Atomics.load(this.control, 1);
    const text = this.decoder.decode(this.body.subarray(0, length));
    if (state === 2) throw new Error(`PostgreSQL: ${text}`);
    this.lastSeen = sequence;
    try {
      return length === 0 ? [] : (JSON.parse(text) as PgRow[]);
    } catch {
      throw new Error('PostgreSQL returned malformed JSON');
    }
  }

  query(sql: string, params: unknown[] = []): PgRow[] {
    return this.exchange({ kind: 'query', sql, params });
  }

  /** Выполнение без результата: DDL, BEGIN, COMMIT. */
  exec(sql: string): void {
    this.exchange({ kind: 'exec', sql });
  }

  /** Номер последнего завершённого обмена — для диагностики. */
  lastSequence(): number {
    return this.lastSeen;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.worker.terminate();
  }
}

/** Открытое соединение на процесс. */
let shared: PgBridge | null = null;

export function pgBridge(options: BridgeOptions): PgBridge {
  if (!shared) shared = new PgBridge(options);
  return shared;
}

export function closePgBridge(): void {
  shared?.close();
  shared = null;
}
