import fs from 'node:fs';
import path from 'node:path';
import { storeModeOf } from '../store-mode.ts';
import { openBridge } from '../postgres/state-backend.ts';
import { RESEARCH_SCHEMA } from '../postgres/schema.ts';
import type { ShowcaseCodingSample } from './coding.ts';

function filePath(): string {
  if (process.env.GIB_RESEARCH_FILE) return process.env.GIB_RESEARCH_FILE;
  if (process.env.GIB_DATA_FILE) return path.join(path.dirname(process.env.GIB_DATA_FILE), 'research-codings.json');
  return path.join(process.cwd(), 'data', 'research-codings.json');
}

let pgReady = false;
function pg() {
  const bridge = openBridge();
  if (!pgReady) {
    for (const stmt of RESEARCH_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      bridge.exec(stmt);
    }
    pgReady = true;
  }
  return bridge;
}

function readFileSamples(): ShowcaseCodingSample[] {
  const fp = filePath();
  try {
    if (!fs.existsSync(fp)) return [];
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8')) as { samples?: ShowcaseCodingSample[] };
    return Array.isArray(parsed.samples) ? parsed.samples : [];
  } catch {
    return [];
  }
}

function writeFileSamples(samples: ShowcaseCodingSample[]): void {
  const fp = filePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ samples }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fp);
}

export function listCodingSamples(): ShowcaseCodingSample[] {
  if (storeModeOf() === 'postgres') {
    const rows = pg().query(
      'SELECT sample_id, profile_id, participant_hash, age_band, lesson, stage, rater_a, rater_b, created_at, updated_at FROM gib.research_codings ORDER BY created_at DESC',
    );
    return rows.map((r) => ({
      sampleId: String(r.sample_id),
      profileId: r.profile_id ? String(r.profile_id) : null,
      participantHash: String(r.participant_hash),
      ageBand: r.age_band as ShowcaseCodingSample['ageBand'],
      lesson: Number(r.lesson),
      stage: r.stage as ShowcaseCodingSample['stage'],
      raterA: r.rater_a ? (typeof r.rater_a === 'string' ? JSON.parse(r.rater_a) : r.rater_a) : null,
      raterB: r.rater_b ? (typeof r.rater_b === 'string' ? JSON.parse(r.rater_b) : r.rater_b) : null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }
  return readFileSamples();
}

export function getCodingSample(sampleId: string): ShowcaseCodingSample | undefined {
  return listCodingSamples().find((s) => s.sampleId === sampleId);
}

export function saveCodingSample(sample: ShowcaseCodingSample): void {
  if (storeModeOf() === 'postgres') {
    pg().query(
      `INSERT INTO gib.research_codings (sample_id, profile_id, participant_hash, age_band, lesson, stage, rater_a, rater_b, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (sample_id) DO UPDATE SET
         profile_id = EXCLUDED.profile_id,
         participant_hash = EXCLUDED.participant_hash,
         age_band = EXCLUDED.age_band,
         lesson = EXCLUDED.lesson,
         stage = EXCLUDED.stage,
         rater_a = EXCLUDED.rater_a,
         rater_b = EXCLUDED.rater_b,
         updated_at = EXCLUDED.updated_at`,
      [
        sample.sampleId,
        sample.profileId ?? null,
        sample.participantHash,
        sample.ageBand,
        sample.lesson,
        sample.stage,
        sample.raterA ? JSON.stringify(sample.raterA) : null,
        sample.raterB ? JSON.stringify(sample.raterB) : null,
        sample.createdAt,
        sample.updatedAt,
      ],
    );
    return;
  }
  const all = readFileSamples();
  const idx = all.findIndex((s) => s.sampleId === sample.sampleId);
  if (idx >= 0) all[idx] = sample;
  else all.unshift(sample);
  writeFileSamples(all);
}

/**
 * При отзыве согласия на видеофиксацию или удалении профиля ребёнка удаляются
 * все связанные с профилем записи видеокодирования.
 */
export function purgeProfileResearchLinks(profileId: string): number {
  if (storeModeOf() === 'postgres') {
    const rows = pg().query(
      'DELETE FROM gib.research_codings WHERE profile_id = $1 RETURNING sample_id',
      [profileId],
    );
    return rows.length;
  }
  const all = readFileSamples();
  const kept = all.filter((s) => s.profileId !== profileId);
  const removed = all.length - kept.length;
  if (removed > 0) writeFileSamples(kept);
  return removed;
}
