import { NextResponse } from 'next/server';
import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import {
  buildBotReply,
  safeSecretMatch,
  sendMaxMessage,
} from '@/lib/bots/messenger';

export const dynamic = 'force-dynamic';

type MaxUpdate = {
  update_type?: string;
  message?: {
    sender?: { user_id?: number; is_bot?: boolean };
    body?: { text?: string };
  };
  user?: { user_id?: number };
};

/**
 * Вебхук бота MAX (`message_created`, `bot_started`).
 *
 * Проверяет секрет `x-max-bot-api-secret` (`MAX_WEBHOOK_SECRET`) за константное
 * время и использует пространство имён `max:<user_id>`, совпадающее с Mini App.
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.MAX_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }
  const providedSecret =
    req.headers.get('x-max-bot-api-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!safeSecretMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!rateLimit(clientKey(req, 'max-webhook'), 300)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const update = parsed.value as MaxUpdate;

  const userId = update.message?.sender?.user_id ?? update.user?.user_id;
  if (update.message?.sender?.is_bot || typeof userId !== 'number' || userId <= 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const rawText =
    update.update_type === 'bot_started'
      ? '/start'
      : typeof update.message?.body?.text === 'string'
        ? update.message.body.text
        : '/start';

  const replyText = buildBotReply({
    parentId: `max:${userId}`,
    rawText,
  });
  const delivery = await sendMaxMessage(userId, replyText);
  return NextResponse.json({ ok: true, delivered: delivery.ok });
}
