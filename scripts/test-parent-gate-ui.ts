/**
 * Браузерная проверка ворот кабинета: без кода — открыто, с кодом — спрашивает,
 * неверный не пускает, верный открывает.
 * Запуск: BASE=http://127.0.0.1:<порт> npx tsx scripts/test-parent-gate-ui.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const chrome = require('@sparticuz/chromium');
const chromeDir = path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS = require(path.join(chromeDir, 'lambdafs.js')).default;
const BASE = process.env.BASE;

async function main() {
  await LambdaFS.inflate(path.join(chromeDir, '../bin/al2023.tar.br'));
  const env = { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}` };
  const args = chrome.args.filter((x: string) => x !== '--disable-web-security' && x !== '--allow-running-insecure-content');
  const browser = await chromium.launch({ executablePath: await chrome.executablePath(), args, env, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 1. Профиль готовим по HTTP без заголовка владельца: браузер в демо-режиме
  //    получает того же владельца по умолчанию, поэтому кабинет увидит профиль.
  const created = await fetch(`${BASE}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Замок', age: 9 }),
  });
  assert.equal(created.status, 200, 'профиль создан по HTTP');
  const profileId = (await created.json()).profile.id as string;
  // Чистое состояние: прошлые прогоны могли оставить код у того же демо-владельца.
  await fetch(`${BASE}/api/parent-pin`, { method: 'DELETE' });

  await page.goto(`${BASE}/parent?profileId=${profileId}`, { waitUntil: 'domcontentloaded' });

  // 2. Пока кода нет — кабинет открыт и показывает отчёт ребёнка.
  await page.getByText('Код пока не задан').waitFor({ timeout: 25000 });
  assert.equal(await page.getByRole('heading', { name: 'Замок' }).count(), 1, 'отчёт ребёнка виден');
  console.log('  ok без кода кабинет открыт, это прямо сказано');

  // 3. Задаём код: слабый отклоняется.
  await page.getByLabel('Код', { exact: true }).fill('1111');
  await page.getByRole('button', { name: 'Задать код' }).click();
  await page.getByText('слишком простой').waitFor({ timeout: 10000 });
  console.log('  ok слабый код отклоняется в интерфейсе');

  // 4. Хороший код сохраняется.
  await page.getByLabel('Код', { exact: true }).fill('5839');
  await page.getByRole('button', { name: 'Задать код' }).click();
  await page.getByText('Код сохранён').waitFor({ timeout: 10000 });
  console.log('  ok код сохранён');

  // 5. Новая сессия браузера: кабинет спрашивает код.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await fresh.newPage();
  await page2.goto(`${BASE}/parent?profileId=${profileId}`, { waitUntil: 'domcontentloaded' });
  await page2.getByText('Этот раздел — для взрослого').waitFor({ timeout: 25000 });
  assert.equal(await page2.getByRole('region', { name: 'Код взрослого' }).count(), 0, 'настройки не видны без кода');
  assert.equal(await page2.getByText('Карта практики').count(), 0, 'данные ребёнка не видны без кода');
  console.log('  ok без кода кабинет закрыт: отчёт не показывается');

  // 6. Неверный код не пускает.
  await page2.getByLabel('Код', { exact: true }).fill('1234');
  await page2.getByRole('button', { name: 'Открыть кабинет' }).click();
  await page2.getByText('Неверный код').waitFor({ timeout: 10000 });
  assert.equal(await page2.getByText('Карта практики').count(), 0, 'после неверного кода отчёт закрыт');
  console.log('  ok неверный код не пускает');

  // 7. Верный код открывает кабинет.
  await page2.getByLabel('Код', { exact: true }).fill('5839');
  await page2.getByRole('button', { name: 'Открыть кабинет' }).click();
  await page2.getByRole('region', { name: 'Код взрослого' }).waitFor({ timeout: 25000 });
  console.log('  ok верный код открывает кабинет');

  // 8. Перезагрузка в той же сессии не спрашивает снова (короткое окно).
  await page2.reload({ waitUntil: 'domcontentloaded' });
  await page2.getByRole('region', { name: 'Код взрослого' }).waitFor({ timeout: 25000 });
  console.log('  ok повторный вход в той же сессии не спрашивает код');

  // 9. Вёрстка экрана кода не переполняет экран.
  const layout = await page2.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  assert.deepEqual(errors, [], 'ошибок страницы нет');
  console.log('  ok ворота кабинета: 390px без переполнения, ошибок нет');

  await browser.close();
  console.log('  ok ворота кабинета работают: без кода открыто, с кодом спрашивает, верный пускает');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
