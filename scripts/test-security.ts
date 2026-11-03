import crypto from 'node:crypto';
import { verifyInitData } from '../lib/telegram.ts';
import { readJsonObject } from '../lib/http-body.ts';
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); console.log('  ok', label); }
const token = 'not-a-real-token';
const now = 1_800_000_000_000;
function sign(user: unknown, seconds: number) {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(seconds), query_id: 'test' });
  const content = [...p.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(content).digest('hex'));
  return p.toString();
}
const valid = sign({ id: 123 }, now / 1000);
check(verifyInitData(valid, token, now).user?.id === 123, 'действительная подпись Telegram');
check(!verifyInitData(valid, 'wrong-token', now).ok, 'неверный токен');
check(!verifyInitData(valid.replace('123', '124'), token, now).ok, 'изменённый пользователь');
check(!verifyInitData(valid + '&user=%7B%22id%22%3A456%7D', token, now).ok, 'повторяющиеся параметры');
check(!verifyInitData(sign({ id: 123 }, now / 1000 - 86401), token, now).ok, 'просроченный auth_date');
check(!verifyInitData(sign({ id: 123 }, now / 1000 + 31), token, now).ok, 'auth_date в будущем');
check(!verifyInitData(sign({ id: '123' }, now / 1000), token, now).ok, 'некорректный user ID');
check(!verifyInitData('x'.repeat(8193), token, now).ok, 'слишком большой initData');
function request(body: string, contentType = 'application/json', extra: Record<string, string> = {}) {
  return new Request('http://test/', { method: 'POST', headers: { 'content-type': contentType, ...extra }, body });
}
check((await readJsonObject(request('{"action":"start"}'))).ok, 'валидный JSON объект');
for (const body of ['null', '[]', '1', '"text"']) {
  const result = await readJsonObject(request(body));
  check(!result.ok && result.status === 400, `не объект: ${body}`);
}
const malformed = await readJsonObject(request('{oops'));
check(!malformed.ok && malformed.status === 400, 'невалидный JSON');
const wrongType = await readJsonObject(request('{}', 'text/plain'));
check(!wrongType.ok && wrongType.status === 415, 'неверный тип данных');
const oversized = await readJsonObject(request(JSON.stringify({ payload: 'x'.repeat(17000) })));
check(!oversized.ok && oversized.status === 413, 'большое тело отклоняется без Content-Length');
const declared = await readJsonObject(request('{}', 'application/json', { 'content-length': '100000' }));
check(!declared.ok && declared.status === 413, 'большой Content-Length отклоняется');

const { clientKey, rateLimit } = await import('../lib/ratelimit.ts');
const one = request('{}', 'application/json', { 'x-forwarded-for': '1.1.1.1' });
const two = request('{}', 'application/json', { 'x-forwarded-for': '2.2.2.2' });
check(clientKey(one, 'test') === clientKey(two, 'test'), 'заголовок X-Forwarded-For нельзя использовать для обхода лимита');
check(clientKey(one, 'test', '123') !== clientKey(one, 'test', '456'), 'подтверждённые родители получают отдельные лимиты');
const key = clientKey(one, 'limit-check', '123');
check(rateLimit(key, 2) && rateLimit(key, 2) && !rateLimit(key, 2), 'лимит действительно блокирует превышение');
