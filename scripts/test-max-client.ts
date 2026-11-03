import assert from 'node:assert/strict';
import { apiFetch, showBackButton, hideBackButton, haptic } from '../lib/telegramClient';
const calls: { url: string; options: RequestInit }[] = [];
let loads = 0; let failFirst = true; const active = new Set<() => void>(); let wrongHaptics = 0;
const win: any = { location: { hash: '' }, sessionStorage: { getItem: () => 'previous-telegram-session' }, Telegram: { WebApp: { initData: 'tg-signed', HapticFeedback: { notificationOccurred() { wrongHaptics++; } } } } };
(globalThis as any).window = win;
(globalThis as any).fetch = async (url: string, options: RequestInit) => { calls.push({ url, options }); return new Response('{}'); };
(globalThis as any).document = {
  createElement() { return { src: '', referrerPolicy: '', onload: null, onerror: null, remove() {} }; },
  head: { appendChild(script: any) {
    loads++; assert.equal(script.src, 'https://st.max.ru/js/max-web-app.js'); assert.equal(script.referrerPolicy, 'no-referrer');
    queueMicrotask(() => { if (failFirst) { failFirst = false; script.onerror(); return; } win.WebApp = { initData: 'max-signed', BackButton: { show() {}, hide() {}, onClick(f: () => void) { active.add(f); }, offClick(f: () => void) { active.delete(f); } } }; script.onload(); });
  } },
};
async function main() {
  await apiFetch('/api/profile');
  assert.equal(loads, 0); assert.equal(new Headers(calls[0].options.headers).get('x-telegram-init-data'), 'tg-signed');
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(() => apiFetch('https://attacker.invalid/api/profile'));
  await assert.rejects(() => apiFetch('/api/../../external'));
  assert.equal(calls.length, 1);
  win.Telegram.WebApp.initData = ''; win.location.hash = '#WebAppData=encoded';
  await assert.rejects(() => apiFetch('/api/profile')); assert.equal(calls.length, 1);
  await Promise.all([apiFetch('/api/profile', { headers: { 'x-telegram-init-data': 'fake' } }), apiFetch('/api/report')]);
  assert.equal(loads, 2); assert.equal(new Headers(calls[1].options.headers).get('x-max-init-data'), 'max-signed');
  assert.equal(new Headers(calls[1].options.headers).get('x-telegram-init-data'), null);
  const one = () => {}, two = () => {};
  showBackButton(one); showBackButton(two); assert.equal(active.size, 1); assert.ok(active.has(two)); hideBackButton(); assert.equal(active.size, 0);
  haptic('error'); assert.equal(wrongHaptics, 0);
  // A client-side transition removes the launch fragment but keeps the bridge in memory.
  win.location.hash = ''; await apiFetch('/api/profile');
  assert.equal(new Headers(calls.at(-1)!.options.headers).get('x-max-init-data'), 'max-signed');
  win.Telegram.WebApp.initData = 'tg-signed'; await assert.rejects(() => apiFetch('/api/profile'));
  win.Telegram.WebApp.initData = ''; win.location.hash = '#WebAppData=one&WebAppData=two'; await assert.rejects(() => apiFetch('/api/profile'));
  console.log('  ok мост MAX загружается только в MAX, после ошибки позволяет повтор и отправляет данные лишь своему API');
  console.log('  ok конфликт платформ, внешний адрес и повтор запуска отклонены; кнопка назад отписана');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
