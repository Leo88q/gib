/**
 * Браузер: блок уведомлений в кабинете на 390×844.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-notifications-page.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const chrome = require('@sparticuz/chromium');
const chromeDir = path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS = require(path.join(chromeDir, 'lambdafs.js')).default;
const BASE = process.env.BASE!;

async function main() {
  await LambdaFS.inflate(path.join(chromeDir, '../bin/al2023.tar.br'));
  const env = { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}` };
  const browser = await chromium.launch({ executablePath: await chrome.executablePath(), args: chrome.args.filter((x: string) => x !== '--disable-web-security'), env, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  const h = { 'content-type': 'application/json' };
  // Демо-владелец один на весь сервер, а POST /api/profile без addChild
  // намеренно возвращает уже существующего ребёнка (защита от повторной
  // отправки формы). В общем прогоне это значит, что тест получит профиль,
  // созданный предыдущим тестом, и будет проверять чужое состояние. Чистим
  // заранее — иначе падение ничего не говорит о продукте.
  const stale = await fetch(`${BASE}/api/profile`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (stale?.profile?.id) await fetch(`${BASE}/api/profile?profileId=${stale.profile.id}`, { method: 'DELETE' }).catch(() => {});
  const a = await (await fetch(`${BASE}/api/profile`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Мира', age: 9 }) })).json();
  await fetch(`${BASE}/api/parent-pin`, { method: 'DELETE' });

  await page.goto(`${BASE}/parent?profileId=${a.profile.id}`, { waitUntil: 'domcontentloaded' });
  const block = page.getByRole('region', { name: 'Уведомления взрослому' });
  await block.waitFor({ timeout: 45000 });
  await block.getByText('Уведомлений нет', { exact: false }).waitFor({ timeout: 30000 });

  const text = await block.innerText();
  assert.ok(text.includes('Не отправлять'), 'по умолчанию выключено');
  assert.ok(text.includes('Раз в неделю') && text.includes('Раз в месяц'), 'две частоты');
  assert.ok(!/каждый день|ежедневно/i.test(text), 'ежедневной рассылки нет');
  assert.ok(text.includes('не отправляем'), 'граница по ребёнку названа');
  console.log('  ok уведомления в кабинете по умолчанию выключены');

  // Включение недельной частоты.
  await block.getByRole('button', { name: 'Раз в неделю' }).click();
  await block.getByText('Уведомления включены', { exact: false }).waitFor({ timeout: 20000 });
  assert.equal(await block.getByRole('button', { name: 'Раз в неделю' }).getAttribute('aria-pressed'), 'true', 'выбор виден ассистивным технологиям');
  console.log('  ok включение недельной частоты работает');

  // Отзыв согласия.
  await block.getByRole('button', { name: 'Не отправлять' }).click();
  await block.getByText('Уведомления выключены', { exact: false }).waitFor({ timeout: 20000 });
  const saved = await (await fetch(`${BASE}/api/notifications?profileId=${a.profile.id}`, { headers: h })).json();
  assert.equal(saved.settings.enabled, false, 'отзыв сохранён на сервере');
  console.log('  ok отзыв согласия сохранён');

  const layout = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  await browser.close();
  console.log('  ok уведомления в кабинете: 390px, включение, отзыв');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
