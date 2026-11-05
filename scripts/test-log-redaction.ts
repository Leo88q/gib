/**
 * Логи: секреты и данные ребёнка не выходят, формат стабильный.
 *
 * Проверка ловит именно утечки: если кто-то добавит в лог тело запроса или
 * подпись платформы, тест упадёт.
 */
import assert from 'node:assert/strict';
import { redact, ownerTag, log } from '../lib/observability/log';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const BACKUP_KEY = 'a'.repeat(64);

// 1. Секретные ключи вырезаются целиком.
const scrubbed = redact({
  initData: 'query_id=AAA&hash=deadbeef',
  authorization: 'Bearer secret',
  cookie: 'session=1',
  token: BOT_TOKEN,
  password: 'hunter2',
  GIB_BACKUP_KEY_HEX: BACKUP_KEY,
});
for (const [key, value] of Object.entries(scrubbed)) {
  assert.equal(value, '[redacted]', `поле ${key} должно быть вырезано`);
}

// 2. Ключи, похожие на пользовательские данные, тоже не выводятся.
const child = redact({ name: 'Мира', age: 9, feelings: ['joy'], body: { anything: 1 } });
assert.equal(child.name, '[redacted]', 'имя ребёнка не попадает в лог');
assert.equal(child.feelings, '[redacted]', 'отметки чувств не попадают в лог');
assert.equal(child.body, '[redacted]', 'тело запроса не попадает в лог');
assert.equal(child.age, 9, 'возраст не секрет, но и не связан с именем');

// 3. Секреты внутри строк вырезаются, даже если ключ безобидный.
const inText = redact({ note: `отправка через ${BOT_TOKEN} не удалась`, keyRef: `ключ ${BACKUP_KEY}` });
assert.ok(!String(inText.note).includes(BOT_TOKEN), 'токен бота вырезан из текста');
assert.ok(!String(inText.keyRef).includes(BACKUP_KEY), 'ключ копий вырезан из текста');
assert.ok(String(inText.note).includes('[redacted]'), 'видно, что именно вырезано');

// 4. Подпись initData вырезается из свободной строки.
const sig = redact({ note: 'auth_date=1700000000&query_id=AAA&hash=abcdef&signature=zzz' });
assert.ok(!String(sig.note).includes('hash=abcdef'), 'hash вырезан');
assert.ok(!String(sig.note).includes('auth_date'), 'auth_date вырезан');

// 5. Глубина и длина ограничены: лог не превращается в дамп.
const deep: Record<string, unknown> = {};
let cursor = deep;
for (let i = 0; i < 12; i++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
const deepOut = redact({ deep });
assert.ok(JSON.stringify(deepOut).includes('[depth]'), 'глубина ограничена');
const long = redact({ note: 'x'.repeat(5000) });
assert.ok(String(long.note).length <= 500, 'длинные строки обрезаны');

// 6. Ошибка превращается в имя и сообщение, без стека с данными.
const error = redact({ error: new Error('сбой базы') });
assert.deepEqual(error.error, { name: 'Error', message: 'сбой базы' });

// 7. Массивы обрезаны, а не раздувают строку.
const big = redact({ items: Array.from({ length: 100 }, (_, i) => i) });
assert.equal((big.items as unknown[]).length, 20, 'массив обрезан до 20');

// 8. Отпечаток владельца включается только явно и не содержит исходный ID.
delete process.env.GIB_LOG_OWNERS;
assert.equal(ownerTag('123456789'), undefined, 'без флага отпечатка нет');
process.env.GIB_LOG_OWNERS = '1';
const tag = ownerTag('123456789')!;
assert.match(tag, /^[0-9a-f]{8}$/, 'отпечаток короткий и стабильный');
assert.ok(!tag.includes('123456789'), 'исходный ID не восстанавливается');
assert.equal(ownerTag('123456789'), tag, 'отпечаток стабилен');
assert.notEqual(ownerTag('987654321'), tag, 'разные владельцы различимы');
delete process.env.GIB_LOG_OWNERS;

// 9. Реальный лог: одна строка JSON, уровень, событие, время.
const lines: string[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
(process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => { lines.push(chunk); return true; };
try {
  process.env.GIB_LOG_LEVEL = 'info';
  log('info', 'session_started', { route: 'session.command', durationMs: 12, initData: 'hash=zzz' });
} finally {
  (process.stdout as unknown as { write: typeof originalWrite }).write = originalWrite;
  delete process.env.GIB_LOG_LEVEL;
}
assert.equal(lines.length, 1, 'одно событие — одна строка');
assert.ok(lines[0].endsWith('\n'));
const parsed = JSON.parse(lines[0]);
assert.equal(parsed.level, 'info');
assert.equal(parsed.event, 'session_started');
assert.equal(parsed.route, 'session.command');
assert.equal(parsed.initData, '[redacted]');
assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/, 'время в ISO');
console.log('  ok структура лога: одна строка JSON, уровень, время');

// 10. Уровень ниже порога не пишется.
const muted: string[] = [];
(process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => { muted.push(chunk); return true; };
try {
  process.env.GIB_LOG_LEVEL = 'error';
  log('info', 'ignored');
  log('debug', 'ignored');
} finally {
  (process.stdout as unknown as { write: typeof originalWrite }).write = originalWrite;
  delete process.env.GIB_LOG_LEVEL;
}
assert.equal(muted.length, 0, 'info при пороге error не пишется');
console.log('  ok порог уровня логирования соблюдается');

console.log('  ok логи: секреты и данные ребёнка не выходят, формат стабильный');
