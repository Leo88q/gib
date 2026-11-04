/**
 * Браузерная проверка семьи: второй ребёнок, переключатель и общая цель.
 * Нужен одноразовый сервер с ключом тестового бота: BASE, TELEGRAM_BOT_TOKEN.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const chrome = require('@sparticuz/chromium');
const chromeDir = path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS = require(path.join(chromeDir, 'lambdafs.js')).default;

const BASE = process.env.BASE ?? 'http://127.0.0.1:3103';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? 'browser-test-telegram-token';

function signedInitData(userId: number, firstName: string) {
  const authDate = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({ auth_date: String(authDate), first_name: firstName, user: JSON.stringify({ id: userId, first_name: firstName }) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

async function main() {
  await LambdaFS.inflate(path.join(chromeDir, '../bin/al2023.tar.br'));
  const env = { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}` };
  const args = chrome.args.filter((x: string) => x !== '--disable-web-security' && x !== '--allow-running-insecure-content');
  const browser = await chromium.launch({ executablePath: await chrome.executablePath(), args, env, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  const uid = 700000000 + Math.floor(Math.random() * 90000000);
  const initData = signedInitData(uid, 'ТестСемья');

  await page.addInitScript(([data]) => {
    // @ts-expect-error window bridge for tests
    window.Telegram = { WebApp: { initData: data, ready() {}, expand() {}, colorScheme: 'light' } };
  }, [initData]);

  // 1. Первый ребёнок через интерфейс.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Имя или ник').fill('Аня');
  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.getByRole('button', { name: /В город!/ }).click();
  await page.getByRole('button', { name: /Дом/ }).first().waitFor({ timeout: 30000 });
  console.log('  ok первый ребёнок создан через интерфейс');

  // 2. Второй ребёнок через «Ещё ребёнок».
  await page.getByRole('button', { name: /Ещё ребёнок/ }).click();
  await page.getByPlaceholder('Имя или ник').fill('Боря');
  await page.getByRole('button', { name: '6', exact: true }).click();
  await page.getByRole('button', { name: /Добавить ребёнка/ }).click();
  const switchGroup = page.getByRole('group', { name: 'Выбрать ребёнка' });
  await switchGroup.waitFor({ timeout: 30000 });
  assert.equal(await switchGroup.getByRole('button').count(), 2, 'в переключателе двое детей');
  console.log('  ok второй ребёнок создан, переключатель появился');

  // 3. Выбранный ребёнок помечен, переключение меняет видимый профиль.
  const boris = switchGroup.getByRole('button', { name: /Боря, 6/ });
  assert.equal(await boris.getAttribute('aria-pressed'), 'true', 'новый ребёнок выбран');
  const anya = switchGroup.getByRole('button', { name: /Аня, 9/ });
  await anya.click();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('group', { name: 'Выбрать ребёнка' }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('group', { name: 'Выбрать ребёнка' }).getByRole('button', { name: /Аня, 9/ }).getAttribute('aria-pressed'), 'true', 'выбор переключился на Аню');
  console.log('  ok переключение между детьми работает и запоминается');

  // 4. Нет переполнения экрана от переключателя (в прошлый раз чипс растянул 390px).
  const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(layout.scroll <= layout.width, `переполнение экрана: ${layout.scroll} > ${layout.width}`);
  console.log('  ok вёрстка 390px без горизонтальной прокрутки');

  // 5. Общая цель видна в семейном разделе и не называет детей.
  await page.getByRole('button', { name: /Семья/ }).click();
  const family = page.getByRole('region', { name: 'Семейные идеи' });
  await family.waitFor({ timeout: 30000 });
  const goalText = await family.locator('.family-goal').first().innerText({ timeout: 10000 });
  assert.ok(/Общая цель семьи/.test(goalText), 'цель показана');
  assert.ok(!/Аня|Боря/.test(goalText), 'в тексте цели нет имён детей');
  console.log('  ok общая цель семьи в интерфейсе без разбивки по детям');

  // 6. Второй ребёнок виден в кабинете родителя.
  await page.getByRole('link', { name: /Родителю/ }).first().click();
  await page.getByRole('heading', { name: 'Дети в семье' }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('group', { name: 'Выбрать ребёнка' }).getByRole('button').count(), 2, 'кабинет показывает двоих');
  const parentLayout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(parentLayout.scroll <= parentLayout.width, `кабинет переполнен: ${parentLayout.scroll} > ${parentLayout.width}`);
  console.log('  ok кабинет родителя: оба ребёнка, без переполнения');

  assert.deepEqual(pageErrors, [], 'ошибок страницы нет');

  // 7. После перезагрузки страницы выбор ребёнка сохраняется, как и оба профиля.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const restored = page.getByRole('group', { name: 'Выбрать ребёнка' });
  await restored.waitFor({ timeout: 30000 });
  assert.equal(await restored.getByRole('button').count(), 2, 'после перезагрузки оба ребёнка на месте');
  assert.equal(await restored.getByRole('button', { name: /Аня, 9/ }).getAttribute('aria-pressed'), 'true', 'выбор сохранён');
  console.log('  ok выбор ребёнка сохраняется после перезагрузки');

  await browser.close();
  console.log('  ok семья в интерфейсе: второй ребёнок, переключение, общая цель, кабинет');
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
