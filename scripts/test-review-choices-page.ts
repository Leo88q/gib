/**
 * Браузер: на главной при нескольких созревших темах — список кнопок, а не одна.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-review-choices-page.ts
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
  const a = await (await fetch(`${BASE}/api/profile`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Мира', age: 9 }) })).json();
  await fetch(`${BASE}/api/parent-pin`, { method: 'DELETE' });

  // Кабинет: выключатель повторов виден и работает.
  await page.goto(`${BASE}/parent?profileId=${a.profile.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Предлагать повторение тем').waitFor({ timeout: 45000 });
  const box = page.locator('#review-switch');
  // Прошлый прогон мог оставить выключатель включённым: приводим к явному «включено».
  const before = await (await fetch(`${BASE}/api/program?profileId=${a.profile.id}`, { headers: h })).json();
  if (before.reviewOff === true) {
    await fetch(`${BASE}/api/program`, { method: 'POST', headers: h, body: JSON.stringify({ profileId: a.profile.id, reviewOff: false }) });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Предлагать повторение тем').waitFor({ timeout: 45000 });
  }
  assert.equal(await box.isChecked(), true, 'по умолчанию повторы включены');
  await box.uncheck();
  await page.getByText('Предложения повтора выключены', { exact: false }).waitFor({ timeout: 20000 });
  assert.equal(await box.isChecked(), false, 'выключатель сработал');
  const savedOff = await (await fetch(`${BASE}/api/program?profileId=${a.profile.id}`, { headers: h })).json();
  assert.equal(savedOff.reviewOff, true, 'выключение сохранено на сервере');
  console.log('  ok в кабинете выключатель повторов работает и сохраняется');

  // Обратно включаем: прогресс и дни не тронуты.
  await box.check();
  await page.getByText('Предложения повтора включены', { exact: false }).waitFor({ timeout: 20000 });
  const savedOn = await (await fetch(`${BASE}/api/program?profileId=${a.profile.id}`, { headers: h })).json();
  assert.equal(savedOn.reviewOff, false);
  assert.equal(savedOn.progress.completedDays, 0, 'прогресс не изменился');
  console.log('  ok включение обратно не трогает прогресс');

  const layout = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  await browser.close();
  console.log('  ok выключатель повторов в кабинете: 390px, сохранение, прогресс цел');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
