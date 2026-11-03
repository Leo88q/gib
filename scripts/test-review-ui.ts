/**
 * Интерфейс повтора в настоящем headless Chromium.
 *
 * Требует одноразовый сервер с `GIB_STORE=sqlite`, `TELEGRAM_BOT_TOKEN` и известным
 * файлом базы: тест сам готовит профиль, проходит день, сдвигает срок повтора в
 * базе и проверяет кнопку на главной, подпись в заходе и исчезновение кнопки.
 *
 * Запуск: BASE=http://127.0.0.1:3100 DB=/tmp/gib-rv.sqlite npx tsx scripts/test-review-ui.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const chrome = require('@sparticuz/chromium');
const chromeDir = path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS = require(path.join(chromeDir, 'lambdafs.js')).default;

const base = process.env.BASE ?? 'http://127.0.0.1:3100';
const dbFile = process.env.DB ?? '';
const token = process.env.BROWSER_TEST_TELEGRAM_TOKEN ?? 'browser-test-telegram-token';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('нужен одноразовый числовой loopback-сервер');
if (!dbFile) throw Error('укажите DB — файл SQLite одноразового сервера');

/** Подпись initData с фиксированным синтетическим токеном: настоящий Telegram не участвует. */
function signedInitData(id: number): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Синтетика' }) });
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', key).update(check).digest('hex'));
  return params.toString();
}

const initData = signedInitData(crypto.randomInt(100_000_000, 2_000_000_000));
const headers = { 'content-type': 'application/json', 'x-telegram-init-data': initData };
const post = async (p: string, b: object) => (await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(b) })).json();
const get = async (p: string) => (await fetch(base + p, { headers })).json();

/** Ответ, который сервер примет для текущего задания. */
function answerFor(item: any): object {
  if (!item || item.type === 'scenario') return { index: 0 };
  const x = item.instance;
  switch (x.kind) {
    case 'choice': case 'cards': return { index: 0 };
    case 'switch-rounds': return { cells: x.rules.map(() => 0) };
    case 'order': return { cells: x.steps.map((_: string, i: number) => i) };
    case 'digits': return { digits: String(x.digits?.[0] ?? 1).repeat(x.digits?.length ?? 1) };
    case 'memory': case 'symbol-memory': return { cells: [...(x.cells ?? [0])] };
    case 'finddiff': return { cells: [0] };
    case 'gonogo': return { targets: [] };
    case 'social-practice': return { skip: true };
    default: return x.answer;
  }
}

/** Готовит профиль: полный день и просроченный повтор. */
async function prepare() {
  const profile = (await post('/api/profile', { name: 'Интерфейс', age: 9 })).profile;
  assert.ok(profile, 'профиль создан');
  const start = await post('/api/session', { action: 'start', profileId: profile.id, storyChoice: true, journey: true });
  const chosen = await post('/api/session', { action: 'select_story', sessionId: start.sessionId, cardId: start.storyOffer[0].id });
  let item = chosen.item, step = chosen.step ?? 0;
  for (;;) {
    const res = await post('/api/session', { action: 'answer', sessionId: start.sessionId, step, answer: answerFor(item), ms: 700 });
    if (!res.next) break;
    item = res.next; step += 1;
  }
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get() as { data: string };
    const state = JSON.parse(row.data);
    const program = state.programStates.find((p: any) => p.profileId === profile.id);
    for (const review of program.reviewStates ?? []) review.dueAt = Date.now() - 86_400_000;
    delete program.reviewDay;
    db.prepare('UPDATE app_state SET data = ? WHERE id = 1').run(JSON.stringify(state));
  } finally { db.close(); }
  const topic = (await get(`/api/session?profileId=${profile.id}`)).program.review;
  assert.ok(topic, 'тема предложена после сдвига срока');
  return topic;
}

async function main() {
  await LambdaFS.inflate(path.join(chromeDir, '../bin/al2023.tar.br'));
  const env = { ...process.env, LD_LIBRARY_PATH: `/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}` };
  const args = chrome.args.filter((x: string) => x !== '--disable-web-security' && x !== '--allow-running-insecure-content');
  const topic = await prepare();
  const browser = await chromium.launch({ executablePath: await chrome.executablePath(), args, env, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(({ data }) => {
      const back = { show() {}, hide() {}, onClick() {}, offClick() {} };
      (window as any).Telegram = { WebApp: { initData: data, ready() {}, expand() {}, BackButton: back } };
    }, { data: initData });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Начать миссию' }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500); // план и программа приходят вторым запросом

    /* ---------- 1. кнопка повтора на главной ---------- */
    const reviewButton = page.getByRole('button', { name: /Вернуться к теме/ });
    assert.equal(await reviewButton.count(), 1, 'карточка повтора видна на главной');
    const label = await reviewButton.innerText();
    assert.ok(label.includes(topic.title), 'виден заголовок темы');
    assert.ok(label.includes('по желанию'), 'в подписи нет давления');

    /* ---------- 2. заход и подпись ---------- */
    await reviewButton.click();
    await page.getByText(/Повтор темы/).waitFor({ timeout: 30000 });
    const notice = await page.getByText(/Повтор темы/).innerText();
    assert.ok(notice.includes('прогресс не потеряется'), 'подпись объясняет, что можно уйти');
    const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(sizes.scroll <= sizes.width + 1, `нет горизонтальной прокрутки: ${JSON.stringify(sizes)}`);

    /* ---------- 3. отказ от выбора ---------- */
    // Пауза объясняет сохранение прогресса в свёрнутой подсказке рядом с кнопкой.
    assert.ok(await page.getByText('Что будет с прогрессом?').count() > 0, 'пауза объясняет сохранение');
    await page.getByRole('button', { name: /⏸ Пауза и домой/ }).click();
    const home = page.getByRole('button', { name: /^(Домой|← Домой|На главную)$/ });
    if (await home.count()) await home.first().click();
    else await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Начать миссию' }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);

    /* ---------- 4. после повтора кнопки нет ---------- */
    assert.equal(await page.getByRole('button', { name: /Вернуться к теме/ }).count(), 0, 'второй повтор в тот же день не предлагается');
    assert.deepEqual(errors, [], 'ошибок на странице нет');
    console.log('  ok интерфейс повтора: кнопка на главной, нейтральная подпись, пауза, кнопка исчезает');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
