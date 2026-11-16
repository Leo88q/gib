/**
 * Агрегированная сводка бизнеса, удержания, групп и исследовательского контура
 * для закрытой админ-панели (`/admin`). Ни одно поле не содержит персональных
 * данных ребёнка, имени, почты или содержимого ответов.
 */
import { storeModeOf } from '../store-mode.ts';
import { pingAsyncPool } from '../postgres/async-pool.ts';
import { loadAnalyticsSourceData } from '../research/export.ts';
import { computeInterRaterReliability } from '../research/coding.ts';
import { listCodingSamples } from '../research/coding-store.ts';
import type { AgeBand } from '../types.ts';

export async function buildAdminOverview(now = Date.now()) {
  const [data, poolPing] = await Promise.all([
    loadAnalyticsSourceData(),
    pingAsyncPool(),
  ]);
  const codings = listCodingSamples();

  const parents = new Set(data.profiles.map((p) => p.parentId));
  const byAgeBand: Record<AgeBand, number> = { '5-7': 0, '8-10': 0, '11-13': 0 };
  const enrolledProfileIds = new Set(data.memberships.map((m) => m.profileId));
  const byMode = { family: 0, group: 0, child_solo: 0 };
  let withGuardianConsent = 0;
  let withVideoConsent = 0;

  for (const p of data.profiles) {
    if (p.band in byAgeBand) byAgeBand[p.band] += 1;
    if (enrolledProfileIds.has(p.id)) byMode.group += 1;
    else if (p.meetingLead === 'child') byMode.child_solo += 1;
    else byMode.family += 1;
    if (p.guardianConsent) withGuardianConsent += 1;
    if (p.videoConsent?.granted) withVideoConsent += 1;
  }

  let activeSubscriptions = 0;
  let expiredSubscriptions = 0;
  for (const sub of data.subs) {
    if (sub.status === 'active' && sub.until > now) activeSubscriptions += 1;
    else if (sub.status === 'expired' || (sub.status === 'active' && sub.until <= now)) expiredSubscriptions += 1;
  }

  let succeededPayments = 0;
  let refundedPayments = 0;
  let pendingPayments = 0;
  let grossRevenueRub = 0;
  let refundedRub = 0;

  for (const pay of data.payments) {
    const val = Number(pay.amount);
    const safeAmount = Number.isFinite(val) ? val : 0;
    if (pay.status === 'succeeded') {
      succeededPayments += 1;
      grossRevenueRub += safeAmount;
    } else if (pay.status === 'refunded') {
      refundedPayments += 1;
      grossRevenueRub += safeAmount;
      refundedRub += safeAmount;
    } else if (pay.status === 'pending' || pay.status === 'creating' || pay.status === 'refund_pending') {
      pendingPayments += 1;
    }
  }

  const completedSessions = data.sessions.filter((s) => Boolean(s.finishedAt) && !s.review);
  const sevenDaysAgo = now - 7 * 86_400_000;
  const thirtyDaysAgo = now - 30 * 86_400_000;
  const active7d = new Set(
    completedSessions.filter((s) => (s.finishedAt ?? 0) >= sevenDaysAgo).map((s) => s.profileId),
  ).size;
  const active30d = new Set(
    completedSessions.filter((s) => (s.finishedAt ?? 0) >= thirtyDaysAgo).map((s) => s.profileId),
  ).size;

  const milestones = { day1Plus: 0, week1Complete: 0, week4Complete: 0, week8Complete: 0, courseComplete60: 0 };
  let totalAttendedMarks = 0;
  const showcaseTotals = { level0: 0, level1: 0, level2: 0 };

  for (const ps of data.programStates) {
    const d = ps.completedDays ?? 0;
    if (d >= 1) milestones.day1Plus += 1;
    if (d >= 5) milestones.week1Complete += 1;
    if (d >= 20) milestones.week4Complete += 1;
    if (d >= 40) milestones.week8Complete += 1;
    if (d >= 60) milestones.courseComplete60 += 1;

    for (const l of ps.lessons ?? []) {
      if (l.attended === true) totalAttendedMarks += 1;
      if (l.showcase === 0) showcaseTotals.level0 += 1;
      if (l.showcase === 1) showcaseTotals.level1 += 1;
      if (l.showcase === 2) showcaseTotals.level2 += 1;
    }
  }

  const irr = computeInterRaterReliability(codings);

  return {
    generatedAt: now,
    storage: {
      mode: storeModeOf(),
      asyncPool: poolPing,
    },
    accounts: {
      families: parents.size,
      profiles: data.profiles.length,
      withGuardianConsent,
      withVideoConsent,
      byAgeBand,
      byMode,
    },
    billing: {
      activeSubscriptions,
      expiredSubscriptions,
      succeededPayments,
      refundedPayments,
      pendingPayments,
      grossRevenueRub: Math.round(grossRevenueRub * 100) / 100,
      refundedRub: Math.round(refundedRub * 100) / 100,
      netRevenueRub: Math.round((grossRevenueRub - refundedRub) * 100) / 100,
      archivedLedgerRows: data.ledgerCount,
    },
    retention: {
      completedSessions: completedSessions.length,
      activeProfiles7d: active7d,
      activeProfiles30d: active30d,
      milestones,
    },
    groups: {
      totalGroups: data.groups.length,
      enrolledProfiles: enrolledProfileIds.size,
      totalAttendedMarks,
      showcaseTotals,
    },
    research: {
      codingSamplesTotal: codings.length,
      pairedSamples: irr.pairedCount,
      cohenKappa: irr.cohenKappa,
      gwetAc1: irr.gwetAc1,
      verdict: irr.verdict,
    },
  };
}
