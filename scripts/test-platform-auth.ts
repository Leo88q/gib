import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requestParent } from '../lib/auth';
const old = { ...process.env };
const request = (headers: Record<string, string> = {}) => new Request('http://example.test/api/profile', { headers });
function sign(token: string) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 123 }) });
  const text = [...p.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(text).digest('hex')); return p.toString();
}
try {
  process.env.TELEGRAM_BOT_TOKEN = 'same-token'; process.env.MAX_BOT_TOKEN = 'same-token';
  assert.equal(requestParent(request({ 'x-telegram-init-data': sign('same-token') })), null);
  assert.equal(requestParent(request({ 'x-max-init-data': sign('same-token') })), null);
  process.env.TELEGRAM_BOT_TOKEN = 'telegram-test'; process.env.MAX_BOT_TOKEN = 'max-test';
  const t = sign('telegram-test'), m = sign('max-test');
  assert.equal(requestParent(request({ 'x-telegram-init-data': t })), '123');
  assert.equal(requestParent(request({ 'x-max-init-data': m })), 'max:123');
  assert.equal(requestParent(request({ 'x-max-init-data': t })), null);
  assert.equal(requestParent(request({ 'x-telegram-init-data': m })), null);
  assert.equal(requestParent(request({ 'x-max-init-data': m, 'x-telegram-init-data': t })), null);
  assert.equal(requestParent(request({ 'x-max-init-data': '' })), null);
  console.log('  ok отдельные токены и пространства имён; совпадающие токены и двойные заголовки отклоняются');
} finally { process.env = old; }
