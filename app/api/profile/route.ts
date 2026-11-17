import { DEFAULT_TIME_ZONE, isTimeZone } from '@/lib/calendar';
import { readJsonObject } from '@/lib/http-body';
import { NextResponse } from 'next/server';
import { store } from '@/lib/store';
import { createStoreJournal } from '@/lib/events/store-journal';
import { ensureSkills } from '@/lib/engine/session';
import { bandOf } from '@/lib/engine/adaptive';
import { requireParent, ownedProfile } from '@/lib/auth';
import { randomUUID } from 'node:crypto';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import type { Profile } from '@/lib/types';
import { CONSENT_VERSION, hasConsent, newConsent } from '@/lib/legal/consent';
import { parseOnboardingAnswers } from '@/lib/onboarding';
import { recordFunnel } from '@/lib/events/funnel-store';
import { verifyParentGateCookie } from '@/lib/parent-gate-cookie';
import { purgeProfileResearchLinks } from '@/lib/research/coding-store';

export const dynamic = 'force-dynamic';

/**
 * Данные ребёнка для клиента: только то, что нужно интерфейсу.
 *
 * `parentId` (идентификатор взрослого в Telegram/MAX) наружу не отдаётся: он не
 * нужен ни одному экрану, зато связывает профиль ребёнка с аккаунтом взрослого.
 * Раньше `profile` возвращался целиком, и в ответе был `parentId` — это ловил
 * независимый security-тест.
 */
function publicProfile(profile: Profile) {
  return {
    id: profile.id, name: profile.name, age: profile.age, band: profile.band, timeZone: profile.timeZone, createdAt: profile.createdAt,
    /**
     * Согласие и ответы онбординга отдаются наружу, потому что интерфейсу нужно
     * решить: показать экран согласия или начать занятие. `householdAdult`
     * влияет и на план встречи, который открывает взрослый.
     */
    consent: hasConsent(profile) ? { version: profile.guardianConsent!.version, at: profile.guardianConsent!.at, current: profile.guardianConsent!.version === CONSENT_VERSION } : null,
    householdAdult: profile.householdAdult ?? null,
    meetingLead: profile.meetingLead ?? null,
  };
}

export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const { parentId } = auth;
  const profiles = store.profilesByParent(parentId);
  // `profile` — ребёнок по умолчанию (первый). Новые клиенты берут `profiles` и
  // помнят выбор сами; старые продолжают получать одно поле и не ломаются.
  const selectedId = new URL(req.url).searchParams.get('profileId');
  const selected = (selectedId ? profiles.find(p => p.id === selectedId) : undefined) ?? profiles[0];
  return NextResponse.json({
    profile: selected ? publicProfile(selected) : null,
    profiles: profiles.map(p => ({ id: p.id, name: p.name, age: p.age, band: p.band })),
  });
}

export async function POST(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-post', auth.parentId), 60)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as {
    parentId?: string;
    name?: string;
    age?: number;
    initData?: string;
    timeZone?: string;
    addChild?: boolean;
    /**
     * Согласие законного представителя. Без него профиль не создаётся: это
     * единственное место, где продукт может проверить, что взрослый видел
     * текст. Профили, созданные до запуска, согласия не имеют и получают
     * требование подтвердить его при первом входе.
     */
    consentAccepted?: boolean;
    consentVersion?: string;
    /** Ответы онбординга: кто ведёт встречу и есть ли дома взрослый. */
    meetingLead?: string;
    householdAdult?: string;
  };
  const { parentId } = auth;
  if (!Number.isInteger(body.age) || body.age! < 5 || body.age! > 13 || typeof body.name !== 'string' || body.name.trim().length > 24) return NextResponse.json({ error: 'invalid_profile' }, { status: 400 });
  if (body.timeZone !== undefined && !isTimeZone(body.timeZone)) return NextResponse.json({ error: 'invalid_time_zone' }, { status: 400 });
  const timeZone = body.timeZone ?? DEFAULT_TIME_ZONE;
  const age = body.age!;
  const name = body.name.trim() || 'Друг';
  /*
   * Согласие обязано быть и обязано относиться к действующей редакции.
   * Проверка стоит до транзакции: без неё в хранилище появится профиль
   * ребёнка, на обработку данных которого согласия нет, и удалить его
   * задним числом будет нечем.
   *
   * Исключение — повторный запрос по уже существующему профилю: старые
   * клиенты вызывают POST дважды, и второй вызов не должен требовать
   * согласия заново.
   */
  const addingChild = body.addChild === true;
  if (addingChild && store.parentPin(parentId) && !verifyParentGateCookie(req, parentId)) {
    const isLocalDemo = process.env.NODE_ENV !== 'production' && parentId.startsWith('demo:');
    if (!isLocalDemo) return NextResponse.json({ error: 'pin_verification_required' }, { status: 403 });
  }
  const existingProfile = addingChild ? undefined : store.profileByParent(parentId);
  if (!existingProfile) {
    if (body.consentAccepted !== true) return NextResponse.json({ error: 'consent_required', version: CONSENT_VERSION }, { status: 403 });
    if (body.consentVersion !== CONSENT_VERSION) return NextResponse.json({ error: 'consent_outdated', version: CONSENT_VERSION }, { status: 409 });
  }
  return store.transaction(() => {
    const existing = store.profileByParent(parentId);
    // Повторный запрос без addChild возвращает того же ребёнка: так работают
    // старые клиенты и повторная отправка формы. Второй ребёнок создаётся
    // только по явному запросу, чтобы сбой сети не плодил профили.
    if (existing && body.addChild !== true) {
      ensureSkills(existing);
      return NextResponse.json({ profile: publicProfile(existing), created: false });
    }
    const profile: Profile = {
      id: 'p_' + randomUUID(), parentId, name, age, band: bandOf(age), timeZone, createdAt: Date.now(),
      // Режим встречи — ответ взрослого на первом экране онбординга. Без него
      // профиль попадал бы в умолчание «взрослый ведёт», и взрослый, выбравший
      // короткие шаги, увидел бы план на 40 минут, который не заказывал.
      ...(body.meetingLead === 'adult' || body.meetingLead === 'child' ? { meetingLead: body.meetingLead } : {}),
      ...(body.householdAdult === 'parent' || body.householdAdult === 'other' || body.householdAdult === 'none' ? { householdAdult: body.householdAdult } : {}),
    };
    // Согласие пишется в тот же момент, что и профиль: разделить их значило бы
    // получить окно, в котором ребёнок уже в базе, а согласия ещё нет.
    if (!existingProfile) profile.guardianConsent = newConsent();
    store.addProfile(profile);
    ensureSkills(profile);
    /*
     * Два шага воронки пишутся здесь, потому что это единственное место, где
     * известно и то, что взрослый дал согласие, и то, что профиль появился.
     * В воронку уходит только идентификатор взрослого: имя и возраст ребёнка
     * в статистике продаж не нужны.
     */
    if (!existingProfile) recordFunnel({ step: 'consent', ownerId: parentId, at: profile.createdAt });
    recordFunnel({ step: 'profile', ownerId: parentId, at: profile.createdAt });
    return NextResponse.json({ profile: publicProfile(profile), created: true });
  });
}

/** Parent-only change. Legacy attendance fields are preserved, not recalculated. */
export async function PATCH(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-update', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value as {
    profileId?: unknown;
    timeZone?: unknown;
    /** Смена режима: кто ведёт встречу. */
    meetingLead?: unknown;
    /** Смена ответа о взрослом в семье. */
    householdAdult?: unknown;
    /** Повторное согласие на новую редакцию текста. */
    consentAccepted?: unknown;
    consentVersion?: unknown;
  };
  const { profileId, timeZone, meetingLead, householdAdult } = body;
  if (typeof profileId !== 'string' || !profileId) return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  // Каждое поле проверяется отдельно: иначе неверный `meetingLead` мог бы
  // пройти вместе с верным часовым поясом и молча не сохраниться.
  if (timeZone !== undefined && !isTimeZone(timeZone)) return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  if (meetingLead !== undefined && meetingLead !== 'adult' && meetingLead !== 'child') return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  if (householdAdult !== undefined && !['parent', 'other', 'none'].includes(householdAdult as string)) return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  if (body.consentAccepted !== undefined && body.consentAccepted !== true) return NextResponse.json({ error: 'invalid_profile_update' }, { status: 400 });
  if (body.consentAccepted === true && body.consentVersion !== CONSENT_VERSION) return NextResponse.json({ error: 'consent_outdated', version: CONSENT_VERSION }, { status: 409 });
  return store.transaction(() => {
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    if (timeZone !== undefined) profile.timeZone = timeZone;
    if (meetingLead !== undefined) profile.meetingLead = meetingLead as 'adult' | 'child';
    if (householdAdult !== undefined) profile.householdAdult = householdAdult as 'parent' | 'other' | 'none';
    // Повторное согласие не переписывает дату первого: важна и та, и другая,
    // но в модели хранится одна, и перезапись новой редакцией — более честный
    // вариант, чем «согласие от 2024 года на текст 2026-го».
    if (body.consentAccepted === true) profile.guardianConsent = newConsent();
    return NextResponse.json({ profile: publicProfile(profile) });
  });
}

/** Удаляет локальный профиль и прогресс; существующие резервные копии не изменяются. */
export async function DELETE(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-delete', auth.parentId), 30)) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  return store.transaction(() => {
    if (!ownedProfile(auth.parentId, profileId)) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
    if (store.parentPin(auth.parentId) && !verifyParentGateCookie(req, auth.parentId)) {
      const isLocalDemo = process.env.NODE_ENV !== 'production' && auth.parentId.startsWith('demo:');
      if (!isLocalDemo) return NextResponse.json({ error: 'pin_verification_required' }, { status: 403 });
    }
    if (store.payments(profileId).some(p => p.status === 'creating' || p.status === 'pending')) return NextResponse.json({ error: 'payment_in_progress' }, { status: 409 });
    store.deleteProfile(profileId);
    // Журнал технических событий и привязки видеокодирования удаляются вместе с профилем.
    createStoreJournal(store).removeProfile(profileId);
    purgeProfileResearchLinks(profileId);
    return NextResponse.json({ ok: true });
  });
}
