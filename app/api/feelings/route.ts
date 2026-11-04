import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { readJsonObject } from '@/lib/http-body';
import { store } from '@/lib/store';
import { calendarDay, profileZone } from '@/lib/calendar';
import {
  addCheckIn,
  emptyFeelingsPreferences,
  publicCheckIns,
  pruneCheckIns,
  removeCheckIn,
  sanitizeFeelings,
  CHECKIN_RETENTION_DAYS,
  MAX_CHECKINS,
  type FeelingCheckIn,
} from '@/lib/feelings/state';
import type { PlayerState } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Отметки чувств: добровольные, только с согласия взрослого.
 *
 * GET    — состояние согласия и сохранённые отметки этого профиля.
 * POST   — `{ action: 'checkin', feelings }` сохранить отметку,
 *          `{ action: 'consent', enabled }` дать или отозвать согласие (взрослый).
 * DELETE — `?checkinId=` удалить одну отметку, без параметра — все.
 *
 * Отметки не попадают в журнал событий, в награды и в отчёт по активности.
 */
function feelingsState(player: PlayerState) {
  return player.feelings ?? { prefs: emptyFeelingsPreferences('8-10'), items: [] };
}

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'feelings', auth.parentId), 120)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const player = store.playerState(profile.id);
    const state = feelingsState(player);
    const items = state.prefs.saveEnabled ? pruneCheckIns(state.items, Date.now()) : [];
    return NextResponse.json({
      enabled: state.prefs.saveEnabled,
      retentionDays: CHECKIN_RETENTION_DAYS,
      limit: MAX_CHECKINS,
      // Отметки отдаём только при согласии: без него их и не должно быть.
      checkins: state.prefs.saveEnabled ? publicCheckIns(items.sort((a, b) => a.at - b.at)) : [],
    });
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'feelings-post', auth.parentId), 90)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;
  if (typeof body.profileId !== 'string' || !body.profileId) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  if (body.action !== 'checkin' && body.action !== 'consent') return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  const keys = Object.keys(body);
  const allowed = body.action === 'checkin' ? ['profileId', 'action', 'feelings'] : ['profileId', 'action', 'enabled'];
  if (keys.some(key => !allowed.includes(key))) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, body.profileId as string);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const player = store.playerState(profile.id);
    const state = feelingsState(player);

    if (body.action === 'consent') {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
      // Согласие даёт только взрослый. Роль проверяется отдельным уровнем доступа,
      // который появится вместе с ролями; сейчас это отдельный явный запрос.
      const prefs = { ...state.prefs, saveEnabled: body.enabled, consentAt: Date.now(), band: profile.band };
      // Отзыв согласия стирает отметки: иначе данные остаются без основания.
      const items = body.enabled ? pruneCheckIns(state.items, Date.now()) : [];
      player.feelings = { prefs, items };
      store.setPlayerState(player);
      return NextResponse.json({ enabled: prefs.saveEnabled, retentionDays: CHECKIN_RETENTION_DAYS, limit: MAX_CHECKINS, checkins: publicCheckIns(items.sort((a, b) => a.at - b.at)) });
    }

    // Отметка без согласия не сохраняется — это правило продукта, а не настройка.
    if (!state.prefs.saveEnabled) return NextResponse.json({ error: 'consent_required' }, { status: 403 });
    const feelings = sanitizeFeelings(body.feelings);
    if (!feelings) return NextResponse.json({ error: 'invalid_feelings' }, { status: 400 });
    const now = Date.now();
    const entry: FeelingCheckIn = { id: 'f_' + randomUUID().replace(/-/g, '').slice(0, 20), day: calendarDay(now, profileZone(profile.timeZone)), feelings, at: now };
    const items = addCheckIn(pruneCheckIns(state.items, now), entry);
    player.feelings = { prefs: state.prefs, items };
    store.setPlayerState(player);
    return NextResponse.json({ enabled: true, retentionDays: CHECKIN_RETENTION_DAYS, limit: MAX_CHECKINS, checkins: publicCheckIns(items.sort((a, b) => a.at - b.at)) });
  });
}

export async function DELETE(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'feelings-delete', auth.parentId), 60)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const url = new URL(req.url);
  const profileId = url.searchParams.get('profileId');
  const checkinId = url.searchParams.get('checkinId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });
  if (checkinId !== null && !/^[a-zA-Z0-9_-]{1,60}$/.test(checkinId)) return NextResponse.json({ error: 'invalid_checkin' }, { status: 400 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    const player = store.playerState(profile.id);
    const state = feelingsState(player);
    const items = checkinId ? removeCheckIn(state.items, checkinId) : [];
    player.feelings = { prefs: state.prefs, items };
    store.setPlayerState(player);
    return NextResponse.json({ enabled: state.prefs.saveEnabled, retentionDays: CHECKIN_RETENTION_DAYS, limit: MAX_CHECKINS, checkins: publicCheckIns(items.sort((a, b) => a.at - b.at)) });
  });
}
