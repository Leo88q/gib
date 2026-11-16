import { timingSafeEqual } from 'node:crypto';
import { store } from '../store.ts';
import { buildReport } from '../engine/session.ts';
import { canSend, DEFAULT_NOTIFICATIONS } from '../family/notifications.ts';
import { issueDeviceLinkCode } from '../web-auth.ts';
import type { Profile } from '../types.ts';

export type Transport = typeof fetch;

export function safeSecretMatch(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function publicAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.GIB_PUBLIC_URL || (env.YOOKASSA_RETURN_URL ? new URL(env.YOOKASSA_RETURN_URL).origin : '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return null;
  }
}

export function formatWeeklyReport(profile: Profile): string {
  const r = buildReport(profile);
  return [
    `Отчёт за неделю: ${profile.name}`,
    `Минут с перерывами: ${r.minutes} · тренировок: ${r.sessions} · заданий: ${r.tasksDone}`,
    `Победа: ${r.win}`,
    `Зона роста: ${r.growth}`,
    `Задание на дом: ${r.home}`,
    `Вопрос за ужином: ${r.question}`,
  ].join('\n\n');
}

export function formatFamilyDigest(profiles: Profile[]): string {
  if (profiles.length === 0) {
    return 'В вашем аккаунте пока нет созданных профилей детей. Откройте тренажёр, чтобы начать первую бесплатную встречу.';
  }
  return profiles.map(formatWeeklyReport).join('\n\n────────────\n\n');
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options: {
    token?: string;
    appUrl?: string | null;
    transport?: Transport;
  } = {},
): Promise<{ ok: boolean; detail: string }> {
  const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, detail: 'no_telegram_token' };
  const fetchFn = options.transport ?? fetch;
  const appUrl = options.appUrl ?? publicAppUrl();

  const replyMarkup =
    appUrl && appUrl.startsWith('https://')
      ? {
          inline_keyboard: [
            [{ text: '🚀 Открыть Город историй', web_app: { url: appUrl } }],
            [
              { text: '👨‍👩‍👧 Кабинет родителя', web_app: { url: `${appUrl}/parent` } },
              { text: '📋 Кабинет педагога', web_app: { url: `${appUrl}/teacher` } },
            ],
          ],
        }
      : undefined;

  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    return { ok: Boolean(data?.ok), detail: data?.ok ? 'ok' : data?.description ?? `http_${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network_error' };
  }
}

export async function sendMaxMessage(
  userId: string | number,
  text: string,
  options: {
    token?: string;
    appUrl?: string | null;
    transport?: Transport;
  } = {},
): Promise<{ ok: boolean; detail: string }> {
  const token = options.token ?? process.env.MAX_BOT_TOKEN;
  if (!token) return { ok: false, detail: 'no_max_token' };
  const fetchFn = options.transport ?? fetch;
  const appUrl = options.appUrl ?? publicAppUrl();
  const fullText = appUrl ? `${text}\n\nОткрыть в браузере или MAX: ${appUrl}` : text;

  try {
    const res = await fetchFn(
      `https://platform-api.max.ru/messages?user_id=${encodeURIComponent(String(userId))}`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: fullText }),
        signal: AbortSignal.timeout(8000),
      },
    );
    return { ok: res.ok, detail: res.ok ? 'ok' : `http_${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network_error' };
  }
}

export async function sendEmailWebhook(
  to: string,
  subject: string,
  text: string,
  options: { transport?: Transport } = {},
): Promise<{ ok: boolean; detail: string }> {
  const webhookUrl = process.env.GIB_EMAIL_WEBHOOK_URL;
  if (!webhookUrl) return { ok: false, detail: 'no_email_webhook' };
  const fetchFn = options.transport ?? fetch;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.GIB_EMAIL_WEBHOOK_SECRET) {
      headers.Authorization = `Bearer ${process.env.GIB_EMAIL_WEBHOOK_SECRET}`;
    }
    const res = await fetchFn(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, detail: res.ok ? 'ok' : `http_${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network_error' };
  }
}

/**
 * Доставляет сообщение взрослому по его каналу (`parentId`):
 *  - `123456789`     → Telegram Bot API;
 *  - `max:123456789` → MAX Bot API;
 *  - `web:...`       → почтовый вебхук (если в платежах профиля указан `receiptEmail`).
 */
export async function deliverToParent(
  parentId: string,
  text: string,
  options: { subject?: string; transport?: Transport; appUrl?: string | null } = {},
): Promise<{ sent: boolean; channel: 'telegram' | 'max' | 'email' | 'none'; detail: string }> {
  if (/^[1-9][0-9]*$/.test(parentId)) {
    const tg = await sendTelegramMessage(parentId, text, options);
    return { sent: tg.ok, channel: 'telegram', detail: tg.detail };
  }
  const maxMatch = parentId.match(/^max:([1-9][0-9]*)$/);
  if (maxMatch) {
    const mx = await sendMaxMessage(maxMatch[1], text, options);
    return { sent: mx.ok, channel: 'max', detail: mx.detail };
  }
  const profiles = store.profilesByParent(parentId);
  const knownEmail = profiles
    .flatMap((p) => store.payments(p.id))
    .map((pay) => pay.receiptEmail)
    .find((e): e is string => Boolean(e));
  if (knownEmail) {
    const em = await sendEmailWebhook(
      knownEmail,
      options.subject ?? 'Город историй — сообщение для взрослого',
      text,
      options,
    );
    return { sent: em.ok, channel: 'email', detail: em.detail };
  }
  return { sent: false, channel: 'none', detail: 'no_delivery_channel' };
}

/**
 * Единая обработка команд бота для Telegram и MAX:
 * `/start`, `/report`, `/parent` (`/cabinet`), `/teacher`, `/link`, `/stop`, `/help`.
 */
export function buildBotReply(params: {
  parentId: string;
  rawText: string;
  appUrl?: string | null;
  now?: number;
}): string {
  const command = params.rawText.trim().split(/\s+/)[0]?.toLowerCase().replace(/@[\w_]+$/, '') ?? '';
  const appUrl = params.appUrl ?? publicAppUrl();
  const profiles = store.profilesByParent(params.parentId);

  if (command === '/link') {
    const issued = issueDeviceLinkCode(params.parentId, params.now);
    return [
      `Код для входа в браузере на компьютере или планшете: ${issued.code}`,
      'Код одноразовый и действует 10 минут.',
      appUrl ? `Откройте ${appUrl} или ${appUrl}/teacher и введите эти 6 цифр.` : 'Откройте сайт Города историй и введите эти 6 цифр.',
    ].join('\n\n');
  }

  if (command === '/report') {
    if (profiles.length === 0) {
      return 'Профиль ребёнка ещё не создан. Нажмите кнопку открытия приложения ниже, чтобы начать первую бесплатную встречу.';
    }
    return formatFamilyDigest(profiles);
  }

  if (command === '/stop' || command === '/unsubscribe') {
    store.setNotificationSettings(params.parentId, DEFAULT_NOTIFICATIONS);
    return 'Автоматическая отправка отчётов отключена. Включить её снова можно в любой момент в кабинете родителя.';
  }

  if (command === '/teacher') {
    const groups = store.groupsByTeacher(params.parentId);
    const groupLine =
      groups.length > 0
        ? `Ваши группы: ${groups.map((g) => `«${g.name}» (код ${g.joinCode})`).join(', ')}.`
        : 'Вы можете создать учебную группу и получить 8-значный код для родителей.';
    return [
      'Кабинет педагога — Город историй',
      groupLine,
      'Для работы на школьном ноутбуке или интерактивной доске отправьте /link и введите 6-значный код в браузере.',
    ].join('\n\n');
  }

  if (command === '/parent' || command === '/cabinet') {
    const names = profiles.map((p) => `${p.name} (${p.age} лет)`).join(', ');
    return [
      'Кабинет взрослого — Город историй',
      names ? `Профили семьи: ${names}.` : 'Профиль ребёнка можно создать при первом запуске тренажёра.',
      'В кабинете доступны план встречи на 40 минут для печати, недельный отчёт без оценок, код группы педагога и управление подпиской.',
      'Команды бота: /report — сводка за неделю, /link — код входа с компьютера, /stop — отключить отчёты.',
    ].join('\n\n');
  }

  // /start, /help и любые прочие сообщения
  return [
    'Добро пожаловать в «Город историй»!',
    'Это годовая программа для детей 5–13 лет: 36 встреч в году, 12 показов и 60 дней коротких историй и упражнений на внимание, память и гибкость — без оценок и рейтингов.',
    '• Первая встреча открыта бесплатно целиком.\n• Три возрастные линейки ведут Лис (5–7), Мира (8–10) и Тима (11–13).\n• Ребёнку сообщения от бота не отправляются.',
    'Полезные команды:\n/report — недельный отчёт для родителя\n/parent — о кабинете родителя\n/teacher — кабинет педагога и группы\n/link — одноразовый код для входа в браузере на ноутбуке\n/stop — выключить периодические отчёты',
  ].join('\n\n');
}

/**
 * Пакетная рассылка периодических отчётов (еженедельных / ежемесячных) всем взрослым,
 * которые явно включили согласие на уведомления и у которых наступил срок отправки.
 */
export async function dispatchDueNotifications(
  options: { now?: number; transport?: Transport; appUrl?: string | null } = {},
): Promise<{ checked: number; sent: number; skipped: number; failed: number }> {
  const now = options.now ?? Date.now();
  const rows = [...store.all().notificationSettings];
  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of rows) {
    checked += 1;
    const settings = entry.settings;
    const decision = canSend(settings, settings.enabled, now);
    if (!decision.allowed) {
      skipped += 1;
      continue;
    }
    const profiles = store.profilesByParent(entry.parentId);
    if (profiles.length === 0) {
      skipped += 1;
      continue;
    }
    const text = formatFamilyDigest(profiles);
    const result = await deliverToParent(entry.parentId, text, {
      subject: 'Город историй — ваш отчёт по занятиям',
      transport: options.transport,
      appUrl: options.appUrl,
    });
    if (result.sent) {
      store.setNotificationSettings(entry.parentId, { ...settings, lastSentAt: now });
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { checked, sent, skipped, failed };
}
