/**
 * Заглушка запуска: production закрыт, пока не выполнены обещанные условия.
 *
 * Зачем тест. Заглушка — единственное, что не даёт выдать прототип за платный
 * продукт. Ошибка в ней двусторонняя: слишком мягкая открывает продажу без
 * оферты и чека, слишком жёсткая — не открывается никогда, и её снимают правкой
 * кода «на глаз». Поэтому проверяется и то, что она закрывает, и то, что она
 * закрывает по названной причине, и что с заполненными данными она открывается.
 *
 * Запуск: npm run test:launch
 */

import { apiMustBeBlocked, isOpsPath, launchBlockers, shouldBlockPath } from '../lib/launch-guard.ts';
import { OPERATOR } from '../lib/legal/documents.ts';

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); console.log('  ok', message); };

const READY_ENV = {
  YOOKASSA_SHOP_ID: '123456',
  YOOKASSA_SECRET_KEY: 'test_key',
  GIB_RECEIPT_VAT_CODE: '1',
  // Продакшен на файле не открывается: без этого условия «всё заполнено»
  // означало бы ещё и «данные лежат в db.json рядом с приложением».
  GIB_STORE: 'postgres',
} as unknown as NodeJS.ProcessEnv;

/* ---- 1. Локально и в тестах ничего не блокируется ---- */

check(!apiMustBeBlocked('development', READY_ENV), 'в разработке API доступен');
check(!apiMustBeBlocked('test', READY_ENV), 'в тестах API доступен');
check(!shouldBlockPath('/api/session', 'development', READY_ENV), 'в разработке занятия открыты');

/* ---- 2. Production закрыт, пока нет правового минимума и оплаты ---- */

check(apiMustBeBlocked('production', {} as NodeJS.ProcessEnv), 'production закрыт по умолчанию');
check(shouldBlockPath('/api/session', 'production', {} as NodeJS.ProcessEnv), 'занятия в production закрыты');
const blockers = launchBlockers({} as NodeJS.ProcessEnv);
check(blockers.length >= 2, 'причин названо несколько, а не «не готово»');
check(blockers.some((reason) => reason.includes('правовые документы')), 'названа правовая причина');
check(blockers.some((reason) => reason.includes('ЮKassa')), 'названа причина по оплате');
check(blockers.some((reason) => reason.includes('чек')), 'названа причина по чеку');

/* ---- 3. Служебные маршруты открыты всегда: иначе не понять, жив ли сервис ---- */

for (const path of ['/api/health', '/api/ready', '/api/metrics']) {
  check(!shouldBlockPath(path, 'production', {} as NodeJS.ProcessEnv), `${path} открыт даже при закрытом API`);
  check(isOpsPath(path), `${path} опознан как служебный`);
}
check(!isOpsPath('/api/session'), 'обычный маршрут не считается служебным');
check(shouldBlockPath('/api/subscribe', 'production', {} as NodeJS.ProcessEnv), 'оплата тоже закрыта, пока не готова');

/* ---- 3a. Файловое хранилище в продакшене — блокер, а не настройка ---- */

const jsonStore = { ...READY_ENV, GIB_STORE: 'json' } as NodeJS.ProcessEnv;
const sqliteStore = { ...READY_ENV, GIB_STORE: 'sqlite' } as NodeJS.ProcessEnv;
// Ключ режима убираем совсем: именно забытая переменная и была дефектом.
const defaultStore = { ...READY_ENV } as NodeJS.ProcessEnv;
delete (defaultStore as Record<string, string | undefined>).GIB_STORE;
check(apiMustBeBlocked('production', defaultStore), 'без GIB_STORE продакшен закрыт: по умолчанию json');
check(apiMustBeBlocked('production', jsonStore), 'GIB_STORE=json не открывает продакшен');
check(apiMustBeBlocked('production', sqliteStore), 'GIB_STORE=sqlite не открывает продакшен');
check(launchBlockers(jsonStore).some((reason) => reason.includes('postgres')), 'причина названа: нужен postgres');
check(launchBlockers(sqliteStore).some((reason) => reason.includes('SQLite')), 'для sqlite причина названа отдельно');
check(!launchBlockers(READY_ENV).some((reason) => reason.includes('хранилище')), 'postgres причиной не считается');
// В разработке и тестах файл допустим: там он один и локальный.
check(!apiMustBeBlocked('development', jsonStore), 'в разработке json по-прежнему работает');
check(!shouldBlockPath('/api/session', 'development', sqliteStore), 'в разработке sqlite не закрывает занятия');

/* ---- 4. Без чек-ставки не открываемся даже с ключами ---- */

const noReceipt = { YOOKASSA_SHOP_ID: '1', YOOKASSA_SECRET_KEY: 'k' } as unknown as NodeJS.ProcessEnv;
check(apiMustBeBlocked('production', noReceipt), 'ключи без чека не открывают продажу');
check(launchBlockers(noReceipt).some((reason) => reason.includes('чек')), 'и это названо причиной');

/* ---- 5. Тестовый флаг открывает API для проверок, но не для всех ---- */

const securityTest = { ...READY_ENV, GIB_SECURITY_TEST: '1' } as NodeJS.ProcessEnv;
check(!apiMustBeBlocked('production', securityTest), 'тестовый флаг открывает production для проверок прав');
check(apiMustBeBlocked('production', { ...READY_ENV, GIB_SECURITY_TEST: '0' } as NodeJS.ProcessEnv), 'флаг «0» не считается включённым');

/* ---- 6. Реквизиты: пока не заполнены, продакшен закрыт ---- */

if (!OPERATOR.name) {
  check(apiMustBeBlocked('production', READY_ENV), 'с заполненными ключами, но без реквизитов API закрыт');
  check(launchBlockers(READY_ENV).every((reason) => !reason.includes('чек') && !reason.includes('ЮKassa')), 'остаётся только правовая причина');
} else {
  check(!apiMustBeBlocked('production', READY_ENV), 'с заполненными реквизитами и оплатой API открывается');
}

console.log('Production закрыт по названным причинам; локальный режим доступен');
