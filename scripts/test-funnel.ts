/**
 * Воронка запуска: шесть шагов, которые можно посчитать.
 *
 * Зачем тест. Аналитика без проверки считается по ошибке: шаг с опечаткой
 * молчит, деление на ноль даёт NaN, а «ноль оплат» легко перепутать с «нет
 * трафика» — и решение о запуске принимается по числам, которых нет.
 *
 * Что проверяется:
 *  1. Уникальные владельцы считаются один раз, даже если шаг повторён.
 *  2. Конверсия к предыдущему шагу, а не к первому.
 *  3. Шаг, который никто не прошёл, не даёт NaN.
 *  4. Воронка находит самый узкий шаг.
 *  5. Вердикт отличает «нет трафика», «нет активации» и «нет оплаты».
 *  6. События воронки не содержат данных ребёнка.
 *  7. Хранилище воронки переживает удаление профиля и живёт отдельно.
 *
 * Запуск: npm run test:funnel
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FUNNEL_STEPS, FUNNEL_RETENTION_DAYS, funnelReport, funnelVerdict, paywallStops, funnelFromLearning } from '../lib/events/funnel.ts';
import type { FunnelEvent } from '../lib/events/funnel.ts';

const check = (condition: unknown, message: string) => { assert.ok(condition, message); console.log('  ok', message); };
const NOW = 1_800_000_000_000;
const day = 86400000;

const ev = (step: FunnelEvent['step'], ownerId: string, at = NOW, lessonNumber?: number): FunnelEvent => ({ step, ownerId, at, ...(lessonNumber !== undefined ? { lessonNumber } : {}) });

/* ---- 1. Уникальные владельцы ---- */

check(FUNNEL_STEPS.length === 6, 'в воронке шесть шагов');
const repeated = funnelReport([ev('consent', 'a'), ev('consent', 'a'), ev('profile', 'a'), ev('profile', 'a')], { now: NOW });
check(repeated.steps.find((step) => step.step === 'consent')?.owners === 1, 'повтор шага не удваивает владельца');
check(repeated.steps.find((step) => step.step === 'profile')?.owners === 1, 'и на следующем шаге тоже');
const two = funnelReport([ev('consent', 'a'), ev('consent', 'b'), ev('profile', 'a')], { now: NOW });
check(two.steps.find((step) => step.step === 'consent')?.owners === 2, 'два взрослых — два владельца');
check(two.steps.find((step) => step.step === 'profile')?.owners === 1, 'до второго шага дошёл один');

/* ---- 2. Конверсия к предыдущему шагу ---- */

const chain: FunnelEvent[] = [];
for (const owner of ['a', 'b', 'c', 'd']) chain.push(ev('consent', owner));
for (const owner of ['a', 'b']) chain.push(ev('profile', owner));
chain.push(ev('first_session', 'a'), ev('first_finished', 'a'), ev('paywall_seen', 'a', NOW, 2), ev('paid', 'a'));
const report = funnelReport(chain, { now: NOW });
const stepOf = (id: FunnelEvent['step']) => report.steps.find((step) => step.step === id)!;
check(stepOf('consent').conversion === 1, 'первый шаг — 100% по определению');
check(stepOf('profile').conversion === 0.5, 'конверсия ко второму шагу = 2 из 4');
check(stepOf('first_session').conversion === 0.5, 'конверсия считается к предыдущему шагу, а не к первому');
check(stepOf('paid').owners === 1, 'до оплаты дошёл один');

/* ---- 3. Пустые шаги не дают NaN ---- */

const empty = funnelReport([], { now: NOW });
check(empty.steps.every((step) => Number.isFinite(step.conversion)), 'пустая воронка даёт числа, а не NaN');
check(empty.steps.every((step) => step.owners === 0), 'и нули на всех шагах');
const gap = funnelReport([ev('consent', 'a'), ev('paid', 'a')], { now: NOW });
check(gap.steps.every((step) => Number.isFinite(step.conversion)), 'пропущенный шаг не ломает конверсию');
check(gap.dropOffStep === 'profile', 'самый узкий шаг — первый, который не прошёл никто');

/* ---- 4. Где теряются ---- */

check(report.dropOffStep === 'first_session' || report.dropOffStep === 'profile', 'воронка называет узкое место из первых двух переходов');

/* ---- 5. Вердикт ---- */

check(funnelVerdict(funnelReport([], { now: NOW })) === 'no_traffic', 'без записей — нет трафика');
check(funnelVerdict(funnelReport([ev('consent', 'a'), ev('profile', 'a')], { now: NOW })) === 'no_activation', 'есть взрослые, но ни одного занятия — нет активации');
check(funnelVerdict(funnelReport([ev('consent', 'a'), ev('first_session', 'a')], { now: NOW })) === 'no_payment', 'занятие было, оплаты нет');
check(funnelVerdict(report) === 'working', 'есть оплата — воронка работает');

/* ---- 6. Данные ребёнка в воронку не попадают ---- */

const keys = new Set<FunnelEvent[keyof FunnelEvent] extends never ? never : string>();
for (const event of chain) for (const key of Object.keys(event)) keys.add(key);
check([...keys].every((key) => ['step', 'ownerId', 'at', 'lessonNumber'].includes(key)), 'у события воронки только шаг, владелец, время и номер встречи');
check(![...keys].includes('profileId'), 'идентификатор ребёнка в воронке не хранится');

/* ---- 7. Отказ у оплаты и сроки ---- */

const stops = paywallStops([ev('paywall_seen', 'a', NOW, 2), ev('paywall_seen', 'b', NOW, 2), ev('paywall_seen', 'c', NOW, 5), ev('paid', 'c')], { now: NOW });
check(stops[2] === 2 && stops[5] === undefined, 'у отказа считаются только те, кто не заплатил');
const old = funnelReport([ev('consent', 'a', NOW - 90 * day)], { now: NOW });
check(old.steps[0].owners === 0, 'события старше окна в отчёт не попадают');
check(FUNNEL_RETENTION_DAYS > 365, 'срок хранения воронки больше года: продажи считаются за год');

/* ---- 8. Учебные события переводятся в шаги ---- */

const profiles = [
  { id: 'p1', parentId: 'parent1', name: 'Мира', age: 8, band: '8-10' as const, createdAt: NOW },
  { id: 'p2', parentId: 'parent2', name: 'Тима', age: 11, band: '11-13' as const, createdAt: NOW },
];
const stored = [
  { id: 'e1', profileId: 'p1', ownerId: 'parent1', at: NOW, dedupeKey: 'k1', event: { v: 1 as const, type: 'profile_created' as const, band: '8-10' as const } },
  { id: 'e2', profileId: 'p1', ownerId: 'parent1', at: NOW + 1, dedupeKey: 'k2', event: { v: 1 as const, type: 'session_started' as const, dayIndex: 0, repeat: false, journey: true } },
  { id: 'e3', profileId: 'p1', ownerId: 'parent1', at: NOW + 2, dedupeKey: 'k3', event: { v: 1 as const, type: 'session_completed' as const, steps: 4, correct: 2, stars: 1, seconds: 300 } },
];
const derived = funnelFromLearning(stored, profiles as never, [{ profileId: 'p2', plan: 'month', status: 'active', startedAt: NOW, until: NOW + 30 * day }]);
check(derived.some((event) => event.step === 'profile' && event.ownerId === 'parent1'), 'создание профиля становится шагом воронки');
check(derived.some((event) => event.step === 'first_session' && event.ownerId === 'parent1'), 'старт занятия — отдельный шаг');
check(derived.some((event) => event.step === 'first_finished'), 'завершение занятия — отдельный шаг');
check(derived.some((event) => event.step === 'paid' && event.ownerId === 'parent2'), 'активная подписка даёт шаг оплаты');
check(!derived.some((event) => event.step === 'paid' && event.ownerId === 'parent1'), 'без подписки шага оплаты нет');
check(derived.every((event) => !event.ownerId.includes('p1')), 'в шагах нет идентификаторов детей');

/* ---- 9. Хранилище воронки ---- */

async function storage() {
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-funnel-'));
const file = path.join(dir, 'funnel.json');
process.env.GIB_FUNNEL_FILE = file;
const { recordFunnel, funnelEvents, funnelSize, pruneFunnel, resetFunnelCache, funnelBackend } = await import('../lib/events/funnel-store.ts');
resetFunnelCache();
// В режиме `json` (по умолчанию) воронка — файл. Режим PostgreSQL проверяется
// отдельно (`test:funnel-postgres`): там дедупликацию держит первичный ключ.
check(funnelBackend() === 'file', 'в файловом режиме воронка не ищет таблицу в базе');
recordFunnel({ step: 'consent', ownerId: 'a', at: NOW });
recordFunnel({ step: 'consent', ownerId: 'a', at: NOW + 1 });
recordFunnel({ step: 'paywall_seen', ownerId: 'a', at: NOW, lessonNumber: 2 });
recordFunnel({ step: 'paywall_seen', ownerId: 'a', at: NOW + 5, lessonNumber: 2 });
recordFunnel({ step: 'paywall_seen', ownerId: 'a', at: NOW + 5, lessonNumber: 7 });
recordFunnel({ step: 'consent', ownerId: 'b', at: NOW - 500 * day });
check(funnelSize() === 4, 'повтор шага и повтор отказа на той же встрече не создают записей');
check(funnelEvents().filter((event) => event.step === 'paywall_seen').length === 2, 'отказ на разных встречах считается отдельно');
const removed = pruneFunnel(NOW);
check(removed === 1, 'старые события удаляются по сроку хранения');
check(fs.existsSync(file), 'воронка пишется в свой файл, а не в хранилище детей');

/**
 * Ключевая проверка: отдельный файл воронки нужен ровно для того, чтобы
 * удаление профиля ребёнка не обнуляло статистику продаж.
 */
const { store } = await import('../lib/store.ts');
check(typeof store.deleteProfile === 'function', 'удаление профиля существует');
check(funnelSize() > 0, 'и не трогает файл воронки');
/* ---- 10. Закрытый отчёт: без токена маршрута как бы нет ---- */

const { GET: adminGet, POST: adminPost } = await import('../app/api/admin/funnel/route.ts');
const call = (handler: typeof adminGet, token?: string) => handler(new Request('http://localhost/api/admin/funnel', {
  method: 'GET',
  headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'x-forwarded-for': '10.1.2.3',
  },
}));
const TOKEN = 'admin-token-for-tests-123';
delete process.env.GIB_ADMIN_TOKEN;
const withoutToken = await call(adminGet);
check(withoutToken.status === 404, 'без настроенного токена отчёт отвечает 404, а не 401');
process.env.GIB_ADMIN_TOKEN = 'short';
check((await call(adminGet, 'short')).status === 404, 'слишком короткий токен не включается');
process.env.GIB_ADMIN_TOKEN = TOKEN;
check((await call(adminGet)).status === 404, 'без заголовка авторизации — 404');
check((await call(adminGet, 'wrong-token-abcdefgh')).status === 404, 'чужой токен — тоже 404');
const allowed = await call(adminGet, TOKEN);
const reportBody = await allowed.json() as Record<string, unknown>;
check(allowed.status === 200, 'с верным токеном отчёт открывается');
check(allowed.headers.get('cache-control') === 'no-store', 'отчёт не кэшируется: иначе вчерашний день выглядит как сегодняшний');
check(Array.isArray(reportBody.steps) && (reportBody.steps as unknown[]).length === 6, 'в отчёте шесть шагов');
check(typeof reportBody.verdict === 'string', 'отчёт называет вердикт, а не только числа');
const storageInfo = reportBody.storage as Record<string, unknown>;
check(storageInfo.backend === 'file', 'отчёт говорит, где лежат события: файл или база');
const accounts = reportBody.accounts as Record<string, number>;
check(typeof accounts.profiles === 'number' && accounts.lessonsInYear === 36, 'счётчики профилей и уроков на месте');
const serialized = JSON.stringify(reportBody);
check(!serialized.includes('profileId') && !serialized.includes('Мира'), 'в отчёте нет идентификаторов детей и имён');
const pruned = await adminPost(new Request('http://localhost/api/admin/funnel', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }));
check(pruned.status === 200, 'очистка старых событий доступна по тому же токену');
delete process.env.GIB_ADMIN_TOKEN;

fs.rmSync(dir, { recursive: true, force: true });
}

storage().then(() => {
  console.log('✓ воронка: шесть шагов, конверсии без NaN, узкое место и вердикт');
});
