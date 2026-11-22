/** Общая нормализация раскадровок: и при записи (storyboard), и при чтении (нормализатор). */
export type Frame = {
  n?: number; план?: string; ракурс?: string; действие?: string;
  реплика?: string; эмоция?: string; секунды?: number; камера?: string;
  [key: string]: unknown;
};
export type BandName = '5-7' | '8-10' | '11-13';
export const BANDS: BandName[] = ['5-7', '8-10', '11-13'];
export type StoryboardRecord = {
  bands: Record<BandName, Frame[]>;
  needs_review: boolean;
  source?: string;
  stats: { frames_per_band: Record<BandName, number>; frames_total: number; empty_replicas: number; verbatim_ok: number; verbatim_miss: number };
};

/** bands[band] может быть массивом кадров ИЛИ объектом { shots: [...] } — нормализуем к массиву. */
function bandFrames(raw: unknown): Frame[] {
  if (Array.isArray(raw)) return raw.filter((f): f is Frame => f !== null && typeof f === 'object');
  if (raw && typeof raw === 'object' && Array.isArray((raw as { shots?: unknown[] }).shots)) {
    return ((raw as { shots: unknown[] }).shots).filter((f): f is Frame => f !== null && typeof f === 'object');
  }
  return [];
}

function countVerbatim(frames: Frame[], sourceText: string): { empty: number; ok: number; miss: number } {
  let empty = 0, ok = 0, miss = 0;
  for (const f of frames) {
    const rep = String(f?.реплика ?? '').trim();
    if (!rep) { empty++; continue; }
    if (sourceText.includes(rep)) ok++; else miss++;
  }
  return { empty, ok, miss };
}

export function normalizeStoryboard(raw: unknown, sourceText: string, source?: string): StoryboardRecord {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bandsIn = (rec.bands && typeof rec.bands === 'object' ? rec.bands : {}) as Record<string, unknown>;
  const bands = {} as Record<BandName, Frame[]>;
  const frames_per_band = {} as Record<BandName, number>;
  let frames_total = 0, empty = 0, ok = 0, miss = 0;
  for (const band of BANDS) {
    const frames = bandFrames(bandsIn[band]);
    bands[band] = frames;
    frames_per_band[band] = frames.length;
    frames_total += frames.length;
    const v = countVerbatim(frames, sourceText);
    empty += v.empty; ok += v.ok; miss += v.miss;
  }
  const schemaOk = BANDS.every((band) => frames_per_band[band] > 0);
  const qualityOk = BANDS.every((band) => frames_per_band[band] >= 6) && miss === 0;
  return {
    bands,
    needs_review: !(schemaOk && qualityOk),
    source,
    stats: { frames_per_band, frames_total, empty_replicas: empty, verbatim_ok: ok, verbatim_miss: miss },
  };
}
