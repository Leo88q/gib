import { validateStore } from './store-validation.ts';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (v: RecordValue, key: string) => Object.hasOwn(v, key);

/** Метка варианта: только значения прежней шкалы, чтобы не тронуть чужие поля. */
const LEGACY_LABEL = new Set(['good', 'partial', 'bad']);

export type StoryQualityCleanupCounts = {
  finishedLabelsRemoved: number;
  activeLabelsRemoved: number;
  activeLabelsDeferred: number;
  activeSnapshotsRemoved: number;
  activeSnapshotsDeferred: number;
  receiptLabelsRemoved: number;
  receiptLabelsDeferred: number;
  sessionsChanged: number;
};

export type StoryQualityCleanupOptions = {
  /**
   * Оставить активные сессии как есть. Нужно, если снимок дня уже отдан ребёнку
   * и его нельзя менять на середине занятия. Квитанции чистятся всегда: они
   * не участвуют в отпечатке повтора.
   */
  deferActive?: boolean;
};

/**
 * Удаляет исторические метки оценки выбора. Оценка личности ребёнка больше не
 * хранится, поэтому метка не должна переживать миграцию ни в снимке истории,
 * ни в ответе, ни в квитанции.
 *
 * Идемпотентность повтора не страдает: отпечаток квитанции считается только по
 * ответу (индекс, клетки, цифры), а не по её содержимому.
 */
export function cleanStoryQuality(
  input: unknown,
  options: StoryQualityCleanupOptions = {}
): { state: RecordValue; counts: StoryQualityCleanupCounts } {
  validateStore(input);
  if (!object(input)) throw new Error('Invalid store');
  const deferActive = options.deferActive === true;
  const state = structuredClone(input);
  const counts: StoryQualityCleanupCounts = {
    finishedLabelsRemoved: 0,
    activeLabelsRemoved: 0,
    activeLabelsDeferred: 0,
    activeSnapshotsRemoved: 0,
    activeSnapshotsDeferred: 0,
    receiptLabelsRemoved: 0,
    receiptLabelsDeferred: 0,
    sessionsChanged: 0,
  };
  if (!Array.isArray(state.sessions)) return { state, counts };
  // Detach records as well: callers may supply aliased objects unlike parsed JSON.
  const sessions = state.sessions.map((session) => structuredClone(session));
  state.sessions = sessions;

  for (const raw of sessions) {
    if (!object(raw)) continue; // validateStore rejects this before cloning
    let changed = false;

    const receipt = object(raw.lastReceipt) ? raw.lastReceipt : undefined;
    const result = object(receipt?.result) ? receipt.result : undefined;
    const summary = object(result?.summary) ? result.summary : undefined;
    if (summary && LEGACY_LABEL.has(String(summary.scenarioQuality))) {
      delete summary.scenarioQuality;
      counts.receiptLabelsRemoved++;
      changed = true;
    }

    const runtime = object(raw.runtime) ? raw.runtime : undefined;
    if (runtime && deferActive) {
      if (object(raw.scenario) && has(raw.scenario, 'quality')) counts.activeLabelsDeferred++;
      if (object(runtime.scenarioAnswer) && has(runtime.scenarioAnswer, 'quality')) counts.activeLabelsDeferred++;
      if (hasLabel(runtime.items) || hasLabel(runtime.storyVersions)) counts.activeSnapshotsDeferred++;
      if (changed) counts.sessionsChanged++;
      continue;
    }
    if (runtime) {
      if (object(raw.scenario) && dropOptionLabel(raw.scenario)) {
        counts.activeLabelsRemoved++;
        changed = true;
      }
      if (object(runtime.scenarioAnswer) && dropAnswerLabel(runtime.scenarioAnswer)) {
        counts.activeLabelsRemoved++;
        changed = true;
      }
      // Без короткого замыкания: иначе второе поле не будет очищено.
      const items = stripSnapshotLabels(runtime.items);
      const versions = stripSnapshotLabels(runtime.storyVersions);
      if (items || versions) {
        counts.activeSnapshotsRemoved++;
        changed = true;
      }
      if (changed) counts.sessionsChanged++;
      continue;
    }

    // Запись без runtime и без finishedAt — незавершённая или битая строка: снимка
    // в ней нет, поэтому метка снимается, но в счётчик завершённых не попадает.
    // Если миграция идёт на живом хранилище, такую строку не трогаем: её ещё
    // может дописать начатое занятие.
    const finished = typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt);
    if (!finished && deferActive) {
      if (object(raw.scenario) && has(raw.scenario, 'quality')) counts.activeLabelsDeferred++;
    } else if (dropAnswerLabel(raw.scenario)) {
      if (finished) counts.finishedLabelsRemoved++;
      else counts.activeLabelsRemoved++;
      changed = true;
    }
    if (changed) counts.sessionsChanged++;
  }

  validateStore(state);
  return { state, counts };
}

/** Ответ на историю: { scenarioId, competency, choice, quality? }. */
function dropAnswerLabel(v: unknown): boolean {
  if (!object(v) || !LEGACY_LABEL.has(String(v.quality))) return false;
  delete v.quality;
  return true;
}

/** Вариант истории: метка имеет смысл только рядом с текстом и подсказкой. */
function dropOptionLabel(v: RecordValue): boolean {
  if (!LEGACY_LABEL.has(String(v.quality))) return false;
  const looksLikeOption = typeof v.text === 'string' || typeof v.note === 'string';
  if (!looksLikeOption) return false;
  delete v.quality;
  return true;
}

function hasLabel(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasLabel);
  if (!object(v)) return false;
  if (has(v, 'quality')) return true;
  return Object.values(v).some(hasLabel);
}

/** Снимок истории лежит в items[].content и (для старых дней) в storyVersions. */
function stripSnapshotLabels(node: unknown): boolean {
  if (Array.isArray(node)) {
    let removed = false;
    for (const child of node) removed = stripSnapshotLabels(child) || removed;
    return removed;
  }
  if (!object(node)) return false;
  let removed = false;
  if (dropOptionLabel(node)) removed = true;
  for (const child of Object.values(node)) removed = stripSnapshotLabels(child) || removed;
  return removed;
}
