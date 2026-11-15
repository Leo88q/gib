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
