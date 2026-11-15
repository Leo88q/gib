/**
 * Заглушка запуска: почему production API закрыт и когда он откроется.
 *
 * Раньше условие было булевым флагом «в продакшене всегда закрыто». Такой флаг
 * нельзя снять осознанно: он не говорит, чего не хватает, и снимается правкой
 * кода, а не заполнением данных. Теперь условие — список **настоящих** причин:
 * незаполненные реквизиты оператора в оферте, отсутствие платёжных ключей и
 * ненастроенный чек. Пока хоть одна причина есть, API отвечает 503.
 *
 * Это не «демо-заглушка вместо продукта», а обратное: продукт открывается
 * только когда выполнены те условия, которые обещаны покупателю. Причины
 * видны дежурному в `/api/ready` (проверка `billing`) — там же, где остальные
 * проверки готовности.
 *
 * Единственное исключение — `GIB_SECURITY_TEST=1`: без него нельзя проверить
 * авторизацию и права на настоящей production-сборке, потому что все запросы
 * упираются в 503 и до проверок дело не доходит. Флаг не ослабляет защиту
 * «на всякий случай»: он требует явной установки в окружении, называется
 * тестовым и проверяется отдельным тестом (`test:security-independent`).
 */
import { OPERATOR, legalMissing, legalReady } from './legal/documents.ts';
import { receiptConfig } from './billing/receipt.ts';
import { storeModeProblem } from './store-mode.ts';

/**
 * Что мешает открыть продакшен. Пустой список — можно открывать.
 *
 * Причины — только те, что действительно нужны покупателю и данным: правовой
 * минимум, оплата с чеком и место, где эти данные лежат. Файловое хранилище
 * (`GIB_STORE=json` по умолчанию или `sqlite`) здесь блокер, потому что
 * продакшен на файле теряет прогресс семьи при пересборке контейнера и
 * расходится между экземплярами. Подробно — `lib/store-mode.ts`.
 */
export function launchBlockers(env: NodeJS.ProcessEnv = process.env): string[] {
  const blockers: string[] = [];
  if (!legalReady(OPERATOR)) blockers.push(`правовые документы: ${legalMissing(OPERATOR).join(', ')}`);
  if (!(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY)) blockers.push('оплата: нет ключей ЮKassa');
  if (receiptConfig(env) === null) blockers.push('чек: не задана ставка НДС');
  const store = storeModeProblem('production', env);
  if (store) blockers.push(store);
  return blockers;
}

export function apiMustBeBlocked(environment: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (environment !== 'production') return false;
  if (env.GIB_SECURITY_TEST === '1') return false;
  // Проверки правового минимума и оплаты идут после флага: тестовый прогон
  // не должен зависеть от того, заполнены ли реквизиты в этой среде.
  return launchBlockers(env).length > 0;
}

/**
 * Служебные маршруты для дежурного: живость, готовность, метрики.
 *
 * Их нельзя закрывать заглушкой запуска: иначе в production невозможно
 * ответить на вопрос «сервис жив, база работает?» — а именно этот ответ
 * и нужен, чтобы не снимать заглушку вслепую. Они не обслуживают
 * пользователей и не отдают персональные данные.
 */
export const OPS_PATHS = ['/api/health', '/api/ready', '/api/metrics'] as const;

export function isOpsPath(pathname: string): boolean {
  return (OPS_PATHS as readonly string[]).includes(pathname);
}

/** Нужно ли ответить заглушкой 503 на этот путь в этом окружении. */
export function shouldBlockPath(pathname: string, environment: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isOpsPath(pathname) && apiMustBeBlocked(environment, env);
}
