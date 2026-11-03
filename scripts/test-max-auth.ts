import assert from 'node:assert/strict';
import { verifyMaxInitData } from '../lib/max-auth';

// Independent HMAC-SHA256 test vector for documented MAX algorithm.
const token = 'max-test-token'; const now = 1_800_000_000_000;
const vector = 'auth_date=1800000000&query_id=test&user=%7B%22id%22%3A123%7D&hash=9c5a338f730176719dd680bfd94e8b18ebcbab80830c9f2dda7524cff40541f3';
assert.deepEqual(verifyMaxInitData(vector, token, now), { ok: true, platform: 'max', subject: 'max:123' });
for (const data of [vector.replace('123', '124'), vector + '&hash=0', vector + '&user=%7B%22id%22%3A99%7D', vector.replace('hash=', 'hash=Z'), '', 'x'.repeat(8193)]) assert.equal(verifyMaxInitData(data, token, now).ok, false);
assert.equal(verifyMaxInitData(vector, 'telegram-test-token', now).ok, false);
assert.equal(verifyMaxInitData(vector, undefined, now).ok, false);
assert.equal(verifyMaxInitData(vector, token, now + 3_600_000).ok, true);
assert.equal(verifyMaxInitData(vector, token, now + 3_601_000).ok, false);
assert.equal(verifyMaxInitData(vector, token, now - 31_000).ok, false);
assert.equal(verifyMaxInitData(vector, token, NaN).ok, false);
console.log('  ok MAX: подпись, чужой токен, изменения, дубликаты и срок');
console.log('  ok MAX: подтверждённый ID отделён пространством имён и лишние поля не возвращаются');
