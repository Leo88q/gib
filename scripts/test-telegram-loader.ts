import assert from 'node:assert/strict';
import { apiFetch } from '../lib/telegramClient';
let loads = 0, requests = 0, fail = true, ready = 0;
const win: any = { location: { hash: '' }, sessionStorage: { getItem: () => null } };
(globalThis as any).window = win;
(globalThis as any).fetch = async (_url: string, options: RequestInit) => { requests++; assert.equal(new Headers(options.headers).get('x-telegram-init-data'), win.Telegram?.WebApp?.initData ?? null); return new Response('{}'); };
(globalThis as any).document = {
  createElement() { return { src: '', referrerPolicy: '', onload: null, onerror: null, remove() {} }; },
  head: { appendChild(script: any) {
    loads++; assert.equal(script.src, 'https://telegram.org/js/telegram-web-app.js'); assert.equal(script.referrerPolicy, 'no-referrer');
    queueMicrotask(() => { if (fail) { fail = false; script.onerror(); } else { win.Telegram = { WebApp: { initData: 'signed', ready() { ready++; } } }; script.onload(); } });
  } },
};
async function main() {
  await apiFetch('/api/profile'); assert.equal(loads, 0);
  win.location.hash = '#tgWebAppData=one&tgWebAppData=two'; await assert.rejects(() => apiFetch('/api/profile')); assert.equal(loads, 0);
  win.location.hash = '#tgWebAppData=encoded'; await assert.rejects(() => apiFetch('/api/profile')); assert.equal(requests, 1);
  await Promise.all([apiFetch('/api/profile'), apiFetch('/api/report')]); assert.equal(loads, 2); assert.equal(ready, 1); assert.equal(requests, 3);
  win.location.hash = ''; await apiFetch('/api/profile'); assert.equal(loads, 2);
  console.log('  ok Telegram SDK загружается только при запуске, ошибка допускает повтор, параллельные запросы ждут один мост');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
