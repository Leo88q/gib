import fs from 'node:fs';
import path from 'node:path';
import { storeModeOf } from '../store-mode.ts';
import { openBridge } from '../postgres/state-backend.ts';
import { FQS_SCHEMA } from '../postgres/schema.ts';
import type { FqsResponseRecord } from './fqs.ts';

function filePath(): string {
  if (process.env.GIB_FQS_FILE) return process.env.GIB_FQS_FILE;
  if (process.env.GIB_DATA_FILE) return path.join(path.dirname(process.env.GIB_DATA_FILE), 'research-fqs.json');
  return path.join(process.cwd(), 'data', 'research-fqs.json');
}

let pgReady = false;
function pg() {
  const bridge = openBridge();
  if (!pgReady) {
    for (const stmt of FQS_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      bridge.exec(stmt);
    }
    pgReady = true;
  }
  return bridge;
}

function readFileResponses(): FqsResponseRecord[] {
  const fp = filePath();
  try {
    if (!fs.existsSync(fp)) return [];
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8')) as { responses?: FqsResponseRecord[] };
    return Array.isArray(parsed.responses) ? parsed.responses : [];
  } catch {
    return [];
  }
}

function writeFileResponses(responses: FqsResponseRecord[]): void {
  const fp = filePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ responses }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fp);
}

export function listFqsResponses(): FqsResponseRecord[] {
  if (storeModeOf() === 'postgres') {
    const rows = pg().query(
      'SELECT response_id, profile_id, participant_hash, age_band, stage, lesson, items, subscales, composite_mean, created_at FROM gib.research_fqs ORDER BY created_at DESC',
    );
    return rows.map((r) => ({
      responseId: String(r.response_id),
      profileId: r.profile_id ? String(r.profile_id) : null,
      participantHash: String(r.participant_hash),
      ageBand: r.age_band as FqsResponseRecord['ageBand'],
      stage: r.stage as FqsResponseRecord['stage'],
      lesson: r.lesson !== null && r.lesson !== undefined ? Number(r.lesson) : null,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items as FqsResponseRecord['items']),
      subscales:
        typeof r.subscales === 'string' ? JSON.parse(r.subscales) : (r.subscales as FqsResponseRecord['subscales']),
      compositeMean: Number(r.composite_mean),
      createdAt: Number(r.created_at),
    }));
  }
  return readFileResponses();
}

export function saveFqsResponse(record: FqsResponseRecord): void {
  if (storeModeOf() === 'postgres') {
    pg().query(
      `INSERT INTO gib.research_fqs
        (response_id, profile_id, participant_hash, age_band, stage, lesson, items, subscales, composite_mean, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (response_id) DO UPDATE SET
         profile_id = EXCLUDED.profile_id,
         participant_hash = EXCLUDED.participant_hash,
         age_band = EXCLUDED.age_band,
         stage = EXCLUDED.stage,
         lesson = EXCLUDED.lesson,
         items = EXCLUDED.items,
         subscales = EXCLUDED.subscales,
         composite_mean = EXCLUDED.composite_mean`,
      [
        record.responseId,
        record.profileId ?? null,
        record.participantHash,
        record.ageBand,
        record.stage,
        record.lesson ?? null,
        JSON.stringify(record.items),
        JSON.stringify(record.subscales),
        record.compositeMean,
        record.createdAt,
      ],
    );
    return;
  }
  const all = readFileResponses();
  const idx = all.findIndex((x) => x.responseId === record.responseId);
  if (idx >= 0) all[idx] = record;
  else all.unshift(record);
  writeFileResponses(all);
}

/**
 * При отзыве исследовательского согласия или удалении профиля ребёнка удаляются
 * все связанные с профилем бланки FQS.
 */
export function purgeProfileFqsLinks(profileId: string): number {
  if (storeModeOf() === 'postgres') {
    const rows = pg().query(
      'DELETE FROM gib.research_fqs WHERE profile_id = $1 RETURNING response_id',
      [profileId],
    );
    return rows.length;
  }
  const all = readFileResponses();
  const kept = all.filter((r) => r.profileId !== profileId);
  const removed = all.length - kept.length;
  if (removed > 0) writeFileResponses(kept);
  return removed;
}
