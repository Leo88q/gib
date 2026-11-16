/**
 * Проверка токенов дизайн-системы: палитра, шкала и контракт ассетов.
 *
 * Зачем это тестом, а не «мы посмотрели глазами»: макет и код разъезжаются
 * молча. Через месяц в макете `#EC6F38`, в компоненте `#ec6f37`, и никто не
 * заметит — пока не начнут сравнивать два экрана рядом. Здесь сверяются три
 * вещи, которые руками не сверить никогда:
 *
 *  1. палитра и контраст (числом, а не на глаз);
 *  2. паритет токенов с макетом `design/preview/index.html`;
 *  3. контракт ассетов: у каждой компетенции есть место, у каждого предмета
 *     гардероба — картинка, неизвестный id уходит на безопасный дефолт.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COLORS, COLOR_SOFT, HERO_ACCENTS, ACCENT_RULE, TYPE_SCALE, RADIUS, SPACE,
  CREATURES, ITEMS, PLACES, PLACE_BY_COMPETENCY,
  creatureArt, itemArt, placeArt, placeForCompetency,
  DEFAULT_CREATURE_ART, DEFAULT_ITEM_ART, DEFAULT_PLACE_ART,
} from '../lib/design/tokens.ts';
import { COMPETENCY_LABELS } from '../lib/content/softskills.ts';
import { SHOP } from '../lib/gamification.ts';

/* ------------------------------------------------------------------ контраст */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (la + 0.05) / (lb + 0.05);
}

/* ------------------------------------------------------------ 1. палитра */

for (const [name, hex] of Object.entries(COLORS)) {
  assert.match(hex, /^#[0-9A-F]{6}$/i, `цвет ${name} не hex: ${hex}`);
}
for (const [name, hex] of Object.entries(COLOR_SOFT)) {
  assert.match(hex, /^#[0-9A-F]{6}$/i, `подложка ${name} не hex: ${hex}`);
}
for (const key of ['ink', 'inkSoft', 'inkFaint', 'cream', 'creamDeep', 'paper', 'line', 'lis', 'mira', 'tima', 'gold']) {
  assert.ok(key in COLORS, `в палитре нет обязательного цвета ${key}`);
}
console.log(`  ok палитра: ${Object.keys(COLORS).length} цветов, все hex`);

assert.equal(HERO_ACCENTS.length, 3, 'проводников должно быть ровно три');
assert.equal(new Set(HERO_ACCENTS.map((h) => h.color)).size, 3, 'у проводников должны быть разные цвета');
assert.deepEqual(HERO_ACCENTS.map((h) => h.band), ['5-7', '8-10', '11-13'], 'линейки не совпадают с программой');
console.log('  ok три линейки, три разных акцента');

assert.equal(ACCENT_RULE.maxPerScreen, 1, 'правило «один акцент на экран» сломано');
assert.equal(ACCENT_RULE.creatureAccents, 0, 'у существ навыков не должно быть своего акцента');
console.log('  ok один акцент на экран, у существ навыков акцента нет');

/* ----------------------------------------------------------------- контраст */

const body = contrast(COLORS.ink, COLORS.cream);
assert.ok(body >= 7, `чернила на бумаге дают ${body.toFixed(2)}:1 — мало для текста`);
const onCard = contrast(COLORS.ink, COLORS.paper);
assert.ok(onCard >= 7, `чернила на карточке дают ${onCard.toFixed(2)}:1 — мало для текста`);
const secondary = contrast(COLORS.inkSoft, COLORS.cream);
assert.ok(secondary >= 4.5, `второй текст даёт ${secondary.toFixed(2)}:1 — ниже AA`);
const caption = contrast(COLORS.inkFaint, COLORS.cream);
assert.ok(caption >= 3, `подписи дают ${caption.toFixed(2)}:1 — ниже AA для мелкого текста`);
// Монетка: тёмно-янтарный текст на янтарной плашке должен читаться.
const coin = contrast('#8A5A12', COLOR_SOFT.gold);
assert.ok(coin >= 4.5, `текст цены на янтарной плашке даёт ${coin.toFixed(2)}:1`);
console.log(`  ok контраст: текст ${body.toFixed(1)}:1, подписи ${caption.toFixed(1)}:1, цена ${coin.toFixed(1)}:1`);

/* ------------------------------------------------------------------- шкала */

const sizes = Object.values(TYPE_SCALE);
for (let i = 1; i < sizes.length; i += 1) {
  assert.ok(sizes[i] < sizes[i - 1], 'шкала типографики должна убывать сверху вниз');
}
assert.ok(RADIUS.xl > RADIUS.lg && RADIUS.lg > RADIUS.md && RADIUS.md > RADIUS.sm, 'радиусы должны убывать');
assert.ok(RADIUS.sm > 0, 'прямых углов в детском регистре нет');
for (let i = 1; i < SPACE.length; i += 1) {
  assert.ok(SPACE[i] > SPACE[i - 1], 'шаг отступов должен возрастать');
}
console.log(`  ok шкалы: ${sizes.length} размеров текста, ${Object.keys(RADIUS).length} радиусов, ${SPACE.length} шагов`);

/* ------------------------------------------------- 2. паритет с макетом */

const mockup = fs.readFileSync(new URL('../design/preview/index.html', import.meta.url), 'utf8');
const root = mockup.match(/:root\{([\s\S]*?)\n  \}/);
assert.ok(root, 'в макете не найден блок :root');
const vars: Record<string, string> = {};
for (const line of root[1].split('\n')) {
  const m = line.match(/--([\w-]+)\s*:\s*([^;]+);/);
  if (m) vars[m[1]] = m[2].trim().toLowerCase();
}
const pairs: [string, string][] = [
  ['ink', COLORS.ink], ['cream', COLORS.cream], ['lis', COLORS.lis],
  ['mira', COLORS.mira], ['tima', COLORS.tima], ['gold', COLORS.gold],
];
for (const [name, token] of pairs) {
  assert.ok(vars[name], `в макете нет переменной --${name}`);
  assert.equal(vars[name], token.toLowerCase(), `--${name} в макете и в токенах расходятся: ${vars[name]} / ${token}`);
}
console.log('  ok макет и токены совпадают по шести цветам');

/* ------------------------------------------- 3. контракт ассетов и связки */

assert.equal(creatureArt('lis'), '/art/v2/creatures/lis.png');
assert.equal(itemArt('crown'), '/art/v2/items/crown.png');
assert.equal(placeArt('yard'), '/art/v2/places/yard.png');
assert.equal(creatureArt('единорог'), DEFAULT_CREATURE_ART, 'неизвестное существо должно уходить на дефолт');
assert.equal(itemArt('head_cap'), DEFAULT_ITEM_ART, 'id магазина — не id картинки: это разные пространства имён');
assert.equal(placeArt(''), DEFAULT_PLACE_ART, 'пустой id места должен уходить на дефолт');
console.log('  ok контракт ассетов: известный id даёт путь, неизвестный — дефолт');

for (const id of ITEMS) {
  const path = itemArt(id);
  assert.ok(path.startsWith('/art/v2/items/') && path.endsWith('.png') && !path.includes('..'), `плохой путь предмета: ${path}`);
}
for (const id of PLACES) {
  assert.ok(placeArt(id).startsWith('/art/v2/places/'), `плохой путь места: ${id}`);
}
for (const id of CREATURES) {
  assert.ok(creatureArt(id).startsWith('/art/v2/creatures/'), `плохой путь персонажа: ${id}`);
}
assert.equal(new Set(ITEMS).size, ITEMS.length, 'предметы дублируются');
assert.equal(new Set(PLACES).size, PLACES.length, 'места дублируются');
console.log(`  ok ${ITEMS.length} предметов, ${PLACES.length} мест, ${CREATURES.length} персонажей без дублей`);

/* Каждая компетенция программы ведёт в своё место — иначе «семь мест» — фикция. */
const competencies = Object.keys(COMPETENCY_LABELS);
assert.equal(competencies.length, 7, 'компетенций должно быть семь');
for (const competency of competencies) {
  const place = placeForCompetency(competency);
  assert.ok((PLACES as readonly string[]).includes(place.split('/').pop()!.replace('.png', '')), `компетенция ${competency} ведёт в неизвестное место`);
}
const mappedPlaces = competencies.map((c) => placeForCompetency(c));
assert.equal(new Set(mappedPlaces).size, 7, 'две компетенции не могут жить в одном месте');
console.log('  ok семь компетенций → семь разных мест');

/* Предметы гардероба: у каждой покупки должна быть картинка. */
const shopItems = SHOP.filter((item) => item.slot === 'head' || item.slot === 'body' || item.slot === 'room');
for (const item of shopItems) {
  assert.notEqual(itemArt(item.variant), DEFAULT_ITEM_ART, `у покупки ${item.id} нет картинки (variant=${item.variant})`);
}
assert.ok(shopItems.length >= 13, 'гардероб внезапно сузился');
console.log(`  ok у всех ${shopItems.length} покупок гардероба и комнаты есть картинка`);

/* Файлы макета на месте: тест не про продакшн-пути, а про то, что черновик не развалился. */
for (const id of PLACES) {
  assert.ok(fs.existsSync(new URL(`../design/preview/img/places/${id}.png`, import.meta.url)), `в макете нет картинки места ${id}`);
}
for (const id of ITEMS) {
  assert.ok(fs.existsSync(new URL(`../design/preview/img/items/${id}.png`, import.meta.url)), `в макете нет картинки предмета ${id}`);
}
console.log('  ok картинки мест и предметов лежат в макете');

/* Паритет с рабочими стилями: :root в app/globals.css — это те же токены.
 * Без этой проверки макет живёт по новым цветам, а приложение — по старым. */
const appCss = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const appRoot = appCss.slice(appCss.indexOf(':root {'), appCss.indexOf('}', appCss.indexOf(':root {')));
const appVar = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(appRoot)?.[1]?.toLowerCase();
const appPairs: [string, string][] = [
  ['ink', COLORS.ink], ['cream', COLORS.cream], ['orange', COLORS.lis],
  ['mint', COLORS.mira], ['violet', COLORS.tima], ['yellow', COLORS.gold],
];
for (const [name, token] of appPairs) {
  assert.equal(appVar(name), token.toLowerCase(), `--${name} в app/globals.css и в токенах расходятся: ${appVar(name)} / ${token}`);
}
console.log('  ok app/globals.css и токены совпадают по шести цветам');

/* Контур карточек: `--line` тоже токен, и он должен быть объявлен.
 * Проверка появилась после того, как `var(--line)` жил в 100 правилах,
 * а самой переменной в :root не было — рамки просто не рисовались. */
assert.equal(appVar('line'), COLORS.line.toLowerCase(), '--line в app/globals.css расходится с токеном line');
const declared = new Set([...appRoot.matchAll(/--[\w-]+(?=\s*:)/g)].map(m => m[0].slice(2)));
const used = new Set([...appCss.matchAll(/var\(--([\w-]+)/g)].map(m => m[1]));
/* --cols читается с запасным значением `var(--cols, 3)`, поэтому не объявлена. */
const undefinedVars = [...used].filter(name => !declared.has(name) && !appCss.includes(`var(--${name},`));
assert.deepEqual(undefinedVars, [], `в CSS используются необъявленные переменные: ${undefinedVars.join(', ')}`);
console.log('  ok у каждой переменной в CSS есть значение в :root');

/* Мягкие подложки тоже сверяются: иначе плашки живут отдельной жизнью. */
const softPairs: [string, string][] = [
  ['lis-soft', COLOR_SOFT.lis], ['mint-soft', COLOR_SOFT.mira],
  ['sky-soft', COLOR_SOFT.tima], ['gold-soft', COLOR_SOFT.gold], ['rose-soft', COLOR_SOFT.rose],
];
for (const [name, token] of softPairs) {
  assert.equal(appVar(name), token.toLowerCase(), `--${name} в app/globals.css и в токенах расходятся`);
}
console.log('  ok пять мягких подложек совпадают с токенами');

/* «Храповик»: литеральные цвета вне :root не должны расти.
 * 278 значений в правилах — это долг старого файла; новые цвета добавляются
 * только токенами. Число можно уменьшать, увеличивать — нет. */
const cssOutsideRoot = appCss.slice(0, appCss.indexOf(':root {')) + appCss.slice(appCss.indexOf('}', appCss.indexOf(':root {')) + 1);
const literals = cssOutsideRoot.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
const uniqueLiterals = new Set(literals.map((l) => l.toLowerCase()));
assert.ok(uniqueLiterals.size <= 75, `литеральных цветов вне :root стало ${uniqueLiterals.size}, потолок — 75`);
assert.ok(literals.length <= 82, `литеральных цветов вне :root стало ${literals.length}, потолок — 82`);
assert.ok(uniqueLiterals.has('#1264c4'), 'рамка фокуса #1264c4 должна остаться явной');
console.log(`  ok литеральных цветов вне :root ${uniqueLiterals.size} (потолок 75), новых не появилось`);

console.log('design-tokens: ok');
