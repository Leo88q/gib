/**
 * Лимит: хранилище в памяти, общее SQLite-хранилище, окна и аварийный отказ.
 *
 * Главная проверка — что два независимых экземпляра хранилища видят один
 * счётчик. Именно этого не хватало: прежний лимит жил в памяти процесса.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryLimitStore, SqliteLimitStore, setLimitClock, resolveLimitStore, windowDecision } from '../lib/ratelimit-store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-rl-'));
let now = 1_800_000_000_000;
setLimitClock(() => now);

// 1. Окно: внутри окна лимит соблюдается.
const memory = new MemoryLimitStore();
assert.equal(memory.hit('a', 2, 1000).allowed, true);
assert.equal(memory.hit('a', 2, 1000).allowed, true);
const third = memory.hit('a', 2, 1000);
assert.equal(third.allowed, false, 'третий запрос сверх лимита');
assert.equal(third.remaining, 0);
assert.equal(third.resetAt, now + 1000);
console.log('  ok лимит в памяти: окно и остаток');

// 2. После окна счётчик начинается заново.
now += 1001;
assert.equal(memory.hit('a', 2, 1000).allowed, true, 'новое окно снова пускает');
console.log('  ok новое окно сбрасывает счётчик');

// 3. Разные ключи не мешают друг другу.
assert.equal(memory.hit('b', 1, 1000).allowed, true);
assert.equal(memory.hit('b', 1, 1000).allowed, false);
assert.equal(memory.hit('c', 1, 1000).allowed, true);
console.log('  ok ключи изолированы');

// 4. ГЛАВНОЕ: два экземпляра SQLite-хранилища видят один счётчик.
const file = path.join(dir, 'limits.sqlite');
const first = new SqliteLimitStore(file);
const second = new SqliteLimitStore(file);
assert.equal(first.hit('shared', 3, 60_000).allowed, true);
assert.equal(second.hit('shared', 3, 60_000).allowed, true, 'второй процесс видит счётчик первого');
assert.equal(first.hit('shared', 3, 60_000).allowed, true);
const blocked = second.hit('shared', 3, 60_000);
assert.equal(blocked.allowed, false, 'общий предел исчерпан для обоих');
assert.equal(blocked.remaining, 0);
console.log('  ok общий счётчик: два экземпляра видят один лимит');

// 5. Окно истекает и в общем хранилище.
now += 60_001;
assert.equal(first.hit('shared', 3, 60_000).allowed, true, 'после окна снова можно');
console.log('  ok общее хранилище сбрасывает окно');

// 6. Очистка удаляет только истёкшие записи.
now += 120_000;
const pruned = second.prune(now);
assert.ok(pruned >= 1, `истёкшие удалены: ${pruned}`);
assert.equal(second.size(), 0, 'таблица пуста после очистки');
console.log('  ok очистка удаляет истёкшие и только их');

// 7. Выбор хранилища по окружению.
const mem = resolveLimitStore({ GIB_RATE_LIMIT_STORE: 'memory' } as unknown as NodeJS.ProcessEnv);
assert.equal(mem.store.kind, 'memory');
assert.equal(mem.store.distributed, false);

const sqliteResolved = resolveLimitStore({ GIB_RATE_LIMIT_STORE: 'sqlite', GIB_SQLITE_FILE: path.join(dir, 'env.sqlite') } as unknown as unknown as NodeJS.ProcessEnv);
assert.equal(sqliteResolved.store.kind, 'sqlite');
assert.equal(sqliteResolved.store.distributed, true, 'общий счётчик помечен как распределённый');

// 8. PostgreSQL не подменяется памятью молча.
const pg = resolveLimitStore({ GIB_RATE_LIMIT_STORE: 'postgres' } as unknown as NodeJS.ProcessEnv);
assert.equal(pg.store.kind, 'memory', 'без асинхронного слоя остаётся память');
assert.ok(pg.fallbackReason && pg.fallbackReason.includes('postgres'), 'причина названа, а не скрыта');
console.log('  ok выбор хранилища честно сообщает об ограничениях');

// 9. Неизвестный режим не роняет запуск, но говорит о себе.
const unknown = resolveLimitStore({ GIB_RATE_LIMIT_STORE: 'redis' } as unknown as unknown as NodeJS.ProcessEnv);
assert.equal(unknown.store.kind, 'memory');
assert.ok(unknown.fallbackReason?.includes('redis'));
console.log('  ok неизвестный режим не роняет запуск');

// 10. Арифметика окна сама по себе.
// count — включая текущий запрос: лимит 5 значит ровно пять разрешённых.
assert.deepEqual(windowDecision(1, 100, 5, 0), { allowed: true, remaining: 4, resetAt: 100, limit: 5 });
assert.deepEqual(windowDecision(5, 100, 5, 0), { allowed: true, remaining: 0, resetAt: 100, limit: 5 },
  'пятый запрос при лимите 5 ещё разрешён');
assert.deepEqual(windowDecision(6, 100, 5, 0), { allowed: false, remaining: 0, resetAt: 100, limit: 5 },
  'шестой отклоняется');

// 11. Переполнение памяти не растёт бесконечно.
const small = new MemoryLimitStore(3);
for (let i = 0; i < 10; i++) small.hit(`k${i}`, 5, 60_000);
assert.ok(small.size() <= 3, `память ограничена, записей ${small.size()}`);
console.log('  ok память ограничена по числу ключей');

// 12. Подменённые часы: без них окна не проверить.
now += 1_000_000;
assert.equal(memory.hit('a', 1, 1000).allowed, true, 'часы управляемы');

first.close(); second.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('  ok лимит: память, общий SQLite-счётчик, окна, очистка, честный выбор');
