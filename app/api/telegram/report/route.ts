import { readJsonObject } from '@/lib/http-body';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { requireParent, ownedProfile } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { buildReport } from '@/lib/engine/session';

export const dynamic = 'force-dynamic';

/**
 * Отправка отчёта родителю в Telegram.
 * В проде: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID в окружении.
 * Без них — возвращаем готовый текст (его же использует бот для ответа в чате).
 */
export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'telegram-report', auth.parentId), 10, 60_000)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as { profileId?: string; chatId?: string };
  if (!body.profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  const profile = ownedProfile(auth.parentId, body.profileId);
  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

  const r = buildReport(profile);
  const text = [
    `Отчёт за неделю: ${profile.name}`,
    `Минут с перерывами: ${r.minutes} · тренировок: ${r.sessions} · заданий: ${r.tasksDone}`,
    `Победа: ${r.win}`,
    `Зона роста: ${r.growth}`,
    `Задание на дом: ${r.home}`,
    `Вопрос за ужином: ${r.question}`,
  ].join('\n\n');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Только подтверждённый Telegram ID родителя; адрес из запроса не принимаем.
  const chatId = /^[1-9][0-9]*$/.test(auth.parentId) ? auth.parentId : null;
  if (!token || !chatId) {
    return NextResponse.json({ sent: false, preview: text, reason: 'no_bot_credentials' });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const data = await res.json();
  return NextResponse.json({ sent: Boolean(data?.ok), text, telegram: data?.ok ? 'ok' : data?.description });
}
