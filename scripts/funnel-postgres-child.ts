/**
 * События воронки в PostgreSQL: запись, дедупликация, срок хранения.
 *
 * Запускается дочерним процессом с `GIB_STORE=postgres`: режим читается один
 * раз на процесс, и подменять его в уже загруженном модуле нельзя — получилось
 * бы «тест прошёл, а продакшен нет».
 *
 * Проверяется именно то, чем база отличается от файла: дедупликацию делает
 * первичный ключ (два экземпляра приложения не создадут две записи об одном
 * шаге), воронка переживает удаление профиля ребёнка и остаётся на месте после
 * перезапуска процесса.
 */
import assert from 'node:assert/strict';

async function main() {
const { funnelBackend, recordFunnel, funnelEvents, funnelSize, pruneFunnel } = await import('../lib/events/funnel-store.ts');

const NOW = 1_800_000_000_000;
const day = 86400000;
const resume = process.env.GIB_FUNNEL_RESUME === '1';

assert.equal(funnelBackend(), 'postgres', 'режим хранилища воронки не postgres');
// Перезапуск: в базе уже лежат три события прошлого процесса. Это и есть
// проверка «воронка в базе, а не в памяти»; дальше считаем приращения.
let base = 0;
if (resume) {
  base = funnelSize();
  assert.equal(base, 3, `после перезапуска в базе ${base} событий, ожидалось 3`);
  console.log(`  ok перезапуск: в базе уже ${base} события прошлого процесса`);
} else {
  assert.equal(funnelSize(), 0, 'новая база начала не с нуля');
}

// Повтор шага не создаёт второй записи — это делает первичный ключ.
recordFunnel({ step: 'consent', ownerId: 'owner-a', at: NOW });
recordFunnel({ step: 'consent', ownerId: 'owner-a', at: NOW + 1 });
// В первом прогоне это первая запись, во втором — уже существующая: в обоих
// случаях повтор шага не должен добавить строку.
const afterConsent = resume ? base : 1;
assert.equal(funnelSize(), afterConsent, 'повтор шага создал вторую строку');

// Отказ у оплаты считается по встрече: на одной встрече — один раз.
recordFunnel({ step: 'paywall_seen', ownerId: 'owner-a', at: NOW, lessonNumber: 2 });
recordFunnel({ step: 'paywall_seen', ownerId: 'owner-a', at: NOW + 5, lessonNumber: 2 });
recordFunnel({ step: 'paywall_seen', ownerId: 'owner-a', at: NOW + 6, lessonNumber: 7 });
// Во втором прогоне оба отказа уже записаны первым процессом — их не прибавится.
const afterPaywall = resume ? base : afterConsent + 2;
assert.equal(funnelSize(), afterPaywall, 'отказ на разных встречах должен считаться отдельно');

// Шаг с опечаткой не попадает в базу: список шагов один на код и на хранилище.
recordFunnel({ step: 'paid_later' as never, ownerId: 'owner-a', at: NOW });
assert.equal(funnelSize(), afterPaywall, 'неизвестный шаг записан в воронку');

const stored = funnelEvents();
assert.equal(stored.length, afterPaywall, 'чтение вернуло не все события');
assert.ok(stored.every((event) => typeof event.ownerId === 'string' && Number.isFinite(event.at)), 'событие без владельца или времени');
assert.ok(stored.filter((event) => event.step === 'paywall_seen').every((event) => Number.isInteger(event.lessonNumber)), 'у отказа потерялся номер встречи');
assert.ok(stored.some((event) => event.lessonNumber === 7), 'номер встречи читается неверно');
assert.ok(!JSON.stringify(stored).includes('profile'), 'в событиях появился идентификатор ребёнка');

// Срок хранения: старое событие удаляется, свежие остаются.
recordFunnel({ step: 'consent', ownerId: 'owner-old', at: NOW - 500 * day });
assert.equal(funnelSize(), afterPaywall + 1, 'старое событие не записалось');
const removed = pruneFunnel(NOW);
assert.equal(removed, 1, `удалено ${removed} событий вместо одного`);
assert.equal(funnelSize(), afterPaywall, 'после очистки осталось неверное число событий');
assert.equal(pruneFunnel(NOW), 0, 'повторная очистка что-то удалила');

console.log('  ok воронка в PostgreSQL: ключ вместо файла, дедупликация, срок хранения');
console.log(`  ok в базе осталось событий: ${funnelSize()}`);

// Мост держит поток базы: закрываем его, иначе процесс не завершится.
const { closePgBridge } = await import('../lib/postgres/bridge.ts');
closePgBridge();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
