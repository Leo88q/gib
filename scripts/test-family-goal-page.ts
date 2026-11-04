/**
 * Браузер: блок общей цели виден в кабинете на 390×844, размер меняется,
 * вклад детей не раскрывается.
 * BASE=http://127.0.0.1:<порт> npx tsx scripts/test-family-goal-page.ts
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

  // Браузер в демо-режиме получает владельца по умолчанию, поэтому профиль
  // создаём без заголовка: иначе кабинет его не увидит.
  const h = { 'content-type': 'application/json' };
  const a = await (await fetch(`${BASE}/api/profile`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Первый', age: 9 }) })).json();
  const b = await (await fetch(`${BASE}/api/profile`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Второй', age: 8, addChild: true }) })).json();
  // Отметки: один подтверждённый вклад у первого ребёнка.
  const fam = await (await fetch(`${BASE}/api/family?profileId=${a.profile.id}`, { headers: h })).json();
  const op = (n: string) => `op-${n}-${Date.now()}`;
  const choose = await (await fetch(`${BASE}/api/family`, { method: 'POST', headers: h, body: JSON.stringify({ profileId: a.profile.id, action: 'choose', ideaId: fam.ideas[0].id, expectedVersion: fam.version, operationId: op('c') }) })).json();
  const report = await (await fetch(`${BASE}/api/family`, { method: 'POST', headers: h, body: JSON.stringify({ profileId: a.profile.id, action: 'report', expectedVersion: choose.version, operationId: op('r') }) })).json();
  await fetch(`${BASE}/api/family`, { method: 'POST', headers: h, body: JSON.stringify({ profileId: a.profile.id, action: 'confirm', expectedVersion: report.version, operationId: op('f') }) });

  await page.goto(`${BASE}/parent?profileId=${a.profile.id}`, { waitUntil: 'domcontentloaded' });
  const section = page.getByRole('region', { name: 'Общая цель семьи' });
  await section.waitFor({ timeout: 40000 });
  await section.getByRole('img', { name: /Общая цель: 1 из/ }).waitFor({ timeout: 40000 });
  const text = await section.innerText();
  assert.ok(/1 из \d+/.test(text), `прогресс семьи виден: ${text.slice(0, 120)}`);
  assert.ok(text.includes('Кто сколько внёс') || text.includes('Пока в цели один ребёнок'), `вклад не раскрывается: ${text.replace(/\n+/g, ' | ').slice(0, 200)}`);
  assert.ok(!text.includes('Первый') && !text.includes('Второй'), 'имён детей в блоке нет');
  console.log('  ok в кабинете видна общая цель без имён детей');

  // Смена размера цели прямо в кабинете.
  await page.locator('#family-goal-size').selectOption('8');
  await page.getByText('Цель — 8 отметок').waitFor({ timeout: 20000 });
  assert.ok((await section.innerText()).includes('1 из 8'), 'размер цели обновился');
  console.log('  ok размер цели меняется в кабинете');

  // Данные не переполняют экран.
  const layout = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(layout.s <= layout.w, `переполнение: ${layout.s} > ${layout.w}`);
  assert.deepEqual(errors, [], 'ошибок страницы нет');

  // Цель остаётся у семьи после перезагрузки.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: 'Общая цель семьи' }).getByText('1 из 8').waitFor({ timeout: 30000 });
  console.log('  ok цель сохраняется после перезагрузки');

  await browser.close();
  console.log('  ok общая цель в кабинете: 390px, смена размера, сохранение');
  void b;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
