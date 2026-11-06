/**
 * Браузер: блок «Данные и согласия» в кабинете на 390×844.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-data-controls-page.ts
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

  await page.goto(`${BASE}/parent?profileId=${a.profile.id}`, { waitUntil: 'domcontentloaded' });
  const block = page.getByRole('region', { name: 'Данные и согласия' });
  await block.waitFor({ timeout: 45000 });
  await block.getByText('Мира', { exact: false }).first().waitFor({ timeout: 30000 });
  const text = await block.innerText();
  assert.ok(text.includes('Сохранённые чувства'), 'категория чувств видна');
  assert.ok(text.includes('Сохранение выключено'), 'по умолчанию сохранение выключено');
  assert.ok(text.includes('не отправляем напоминания'), 'уведомления честно выключены');
  assert.ok(text.includes('Скачать данные ребёнка'), 'выгрузка доступна');
  assert.ok(text.includes('Удалить профиль и все данные'), 'удаление доступно');
  assert.ok(!/радость|спокойствие/.test(text), 'содержимого чувств нет');
  console.log('  ok блок данных виден в кабинете: категории, согласия, действия');

  // Кнопок выгрузки/удаления ровно по одной: нет дублей со старым блоком.
  assert.equal(await page.getByRole('button', { name: /Скачать/ }).count(), 1, 'одна кнопка выгрузки');
  assert.equal(await page.getByRole('button', { name: /Удалить профиль и все данные/ }).count(), 1, 'одна кнопка удаления');
  console.log('  ok кнопки выгрузки и удаления не дублируются');

  const layout = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  await browser.close();
  console.log('  ok данные и согласия в кабинете: 390px, без переполнения и ошибок');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
