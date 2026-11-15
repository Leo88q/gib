/**
 * Воронка после перезапуска: события лежат в базе, а не в памяти процесса.
 *
 * Отдельный процесс нарочно: если проверять в том же процессе, что писал,
 * тест увидит кэш и подтвердит то, чего в продакшене не будет.
 */
import assert from 'node:assert/strict';

async function main() {
const { funnelBackend, funnelEvents, funnelSize } = await import('../lib/events/funnel-store.ts');

assert.equal(funnelBackend(), 'postgres', 'режим воронки после перезапуска не postgres');
const size = funnelSize();
const events = funnelEvents();
assert.equal(size, 3, `после перезапуска событий ${size}, ожидалось 3`);
assert.equal(events.length, 3, 'чтение после перезапуска вернуло не все события');
assert.ok(events.some((event) => event.step === 'paywall_seen' && event.lessonNumber === 7), 'номер встречи не пережил перезапуск');
assert.ok(events.every((event) => !Number.isNaN(event.at) && event.at > 0), 'время события потерялось');

console.log('  ok данные на месте: воронка читается после перезапуска, номер встречи сохранён');

const { closePgBridge } = await import('../lib/postgres/bridge.ts');
closePgBridge();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
