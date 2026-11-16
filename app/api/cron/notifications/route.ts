import { NextResponse } from 'next/server';
import { dispatchDueNotifications, safeSecretMatch } from '@/lib/bots/messenger';

export const dynamic = 'force-dynamic';

/**
 * Планировщик периодических отчётов взрослому (вызывается по расписанию cron/systemd/GitHub/Docker).
 * Защищён заголовком `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  }
  const authHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!safeSecretMatch(authHeader, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const summary = await dispatchDueNotifications();
  return NextResponse.json({ ok: true, ...summary });
}
