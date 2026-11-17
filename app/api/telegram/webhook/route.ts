import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import {
  buildBotReply,
  safeSecretMatch,
  sendTelegramMessage,
} from '@/lib/bots/messenger';

export const dynamic = 'force-dynamic';

type TelegramUpdate = {
  update_id?: number;
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number; is_bot?: boolean };
    text?: string;
  };
};

/**
 * Вебхук Telegram-бота: принимает команды взрослого (`/start`, `/report`,
 * `/parent`, `/teacher`, `/link`, `/stop`) и отвечает кнопками запуска Mini App.
 *
 * Защищён обязательным заголовком `x-telegram-bot-api-secret-token`
 * (`TELEGRAM_WEBHOOK_SECRET`), сверяемым за константное время.
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }
  const providedSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!safeSecretMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, 'tg-webhook'), 300)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const update = parsed.value as TelegramUpdate;
  const msg = update.message;
  if (!msg || msg.from?.is_bot || typeof msg.from?.id !== 'number' || typeof msg.chat?.id !== 'number') {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (msg.chat.type && msg.chat.type !== 'private') {
    return NextResponse.json({ ok: true, ignored: 'non_private_chat' });
  }

  const parentId = String(msg.from.id);
  const replyText = buildBotReply({
    parentId,
    rawText: typeof msg.text === 'string' ? msg.text : '/start',
  });
  const delivery = await sendTelegramMessage(msg.chat.id, replyText);
  return NextResponse.json({ ok: true, delivered: delivery.ok });
}
