/**
 * Браузерная проверка полосы «Дни занятий» на карте практики.
 * 390×844: 28 дней умещаются, пустой день назван нейтрально, слова «пропуск» нет.
 * Запуск: BASE=http://127.0.0.1:<порт> npx tsx scripts/test-activity-ui.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { chromium } from 'playwright-core';
const require = createRequire(import.meta.url);
const chrome = require('@sparticuz/chromium');
const chromeDir = path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS = require(path.join(chromeDir, 'lambdafs.js')).default;
const BASE = process.env.BASE!;
function signed(id: number) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Тест' }) });
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('browser-test-telegram-token').digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}
async function main() {
  await LambdaFS.inflate(path.join(chromeDir, '../bin/al2023.tar.br'));
  const env = { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}` };
  const args = chrome.args.filter((x: string) => x !== '--disable-web-security' && x !== '--allow-running-insecure-content');
  const browser = await chromium.launch({ executablePath: await chrome.executablePath(), args, env, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([d]) => { (window as any).Telegram = { WebApp: { initData: d, ready() {}, expand() {} } }; }, [signed(700000000 + Math.floor(Math.random() * 1e7))]);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Имя или ник').fill('Карта');
  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.getByRole('button', { name: /В город!/ }).click();
  await page.getByRole('button', { name: /Карта/ }).click();
  const strip = page.getByRole('region', { name: 'Карта практики' });
  await strip.waitFor({ timeout: 30000 });
  await page.getByRole('heading', { name: 'Дни занятий' }).waitFor({ timeout: 15000 });
  const cells = await page.locator('.activity-day').count();
  assert.equal(cells, 28, '28 дней в полосе');
  const box = await page.locator('.activity-days').boundingBox();
  assert.ok(box && box.width <= 390, `полоса шире экрана: ${box?.width}`);
  const layout = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  const text = await page.locator('.activity-strip').innerText();
  assert.ok(!/пропуск/i.test(text), 'нет слова «пропуск»');
  assert.ok(/занятий не было/.test(await page.locator('.activity-day .sr-only').first().innerText()), 'пустой день назван нейтрально');
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  await browser.close();
  console.log('  ok карта: 28 дней без переполнения, пустой день назван нейтрально');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
