/**
 * Чек по 54-ФЗ: то, без чего приём денег с родителей нельзя считать законным.
 *
 * Что здесь есть. Данные чека собираются на сервере из суммы платежа и
 * передаются в ЮKassa вместе с запросом на оплату — провайдер выставляет чек
 * через подключённую кассу. Ключевое: сумма и описание берутся из записи
 * платежа, а не из запроса клиента, иначе чек можно занизить.
 *
 * Чего здесь нет и не будет. Здесь нет фискального регистратора и проверки,
 * что касса действительно подключена: это настройка магазина в личном кабинете
 * ЮKassa, а не код. Тест проверяет только форму чека и её устойчивость к
 * подмене.
 *
 * Ставка НДС. Для услуг в сфере образования и ИТ применяются разные режимы;
 * продукт не выбирает ставку сам — она приходит из конфигурации, а без неё
 * чек не формируется. Молча подставить «без НДС» нельзя: это налоговое
 * утверждение, которое код делать не вправе.
 */

export type VatCode = 1 | 2 | 3 | 4 | 5 | 6;

/** Коды НДС ЮKassa: 1 — без НДС, 2 — 0%, 3 — 10%, 4 — 20%, 5 — 10/110, 6 — 20/120. */
export const VAT_CODES: readonly VatCode[] = [1, 2, 3, 4, 5, 6];

export type ReceiptItem = {
  description: string;
  quantity: string;
  amount: { value: string; currency: 'RUB' };
  vat_code: VatCode;
  payment_subject: 'service';
  payment_mode: 'full_payment';
};

export type Receipt = {
  customer: { email?: string };
  items: ReceiptItem[];
};

/**
 * Настройка чека.
 *
 * `vatCode` обязателен: без него чек не собирается. `customerEmail` — почта
 * взрослого; если её нет, чек не сформировать, и оплата не начинается. Это
 * жёстче, чем «пришлём потом»: чек обязан быть на момент расчёта.
 */
export type ReceiptConfig = { vatCode: VatCode };

/**
 * Настройка чека.
 *
 * Из окружения берётся только ставка НДС: она относится к магазину, а не к
 * покупателю. Почта — часть конкретного платежа (у семьи может быть несколько
 * взрослых и разные адреса), поэтому она приезжает из записи платежа, а не из
 * переменной окружения. Держать почту в env значило бы отправлять все чеки на
 * один адрес.
 */
export function receiptConfig(env: Record<string, string | undefined> = process.env): ReceiptConfig | null {
  const raw = env.GIB_RECEIPT_VAT_CODE;
  if (!raw) return null;
  const code = Number(raw);
  if (!VAT_CODES.includes(code as VatCode)) return null;
  return { vatCode: code as VatCode };
}

/** Слабая проверка адреса: строгий шаблон отсекает валидные адреса. */
export function validEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value);
}

/**
 * Чек на платёж.
 *
 * Проверки на входе — не формальность: `amount` приходит из записи платежа,
 * и если она повреждена, чек с неверной суммой лучше не отправлять вовсе.
 */
export function buildReceipt(options: { amount: string; currency: 'RUB'; description: string; config: ReceiptConfig; customerEmail: string }): Receipt {
  const { amount, currency, description, config, customerEmail } = options;
  if (!/^\d{1,9}\.\d{2}$/.test(amount)) throw new Error('invalid_receipt_amount');
  if (!VAT_CODES.includes(config.vatCode)) throw new Error('invalid_vat_code');
  if (!validEmail(customerEmail)) throw new Error('invalid_customer_email');
  // Описание чека ограничено провайдером; обрезаем по границе слова, а не
  // посреди слова — иначе в чеке окажется «ГИБ: доступ на 30 дн».
  const safe = description.trim().slice(0, 128);
  if (!safe) throw new Error('invalid_receipt_description');
  return {
    customer: { email: customerEmail },
    items: [{ description: safe, quantity: '1.00', amount: { value: amount, currency }, vat_code: config.vatCode, payment_subject: 'service', payment_mode: 'full_payment' }],
  };
}

/** Есть ли у платежа всё для чека. Используется проверкой готовности запуска. */
export function receiptReady(config: ReceiptConfig | null): boolean {
  return !!config;
}
