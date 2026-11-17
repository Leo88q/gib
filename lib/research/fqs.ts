/**
 * Цифровой обезличенный опросник качества дружбы (Friendship Quality Scale — FQS,
 * Bukowski, Hoza & Boivin, 1994) для исследовательского контура ВУЗа.
 *
 * Методологические границы (см. `docs/research-passport.md`):
 *  - FQS измеряет качество диадной дружбы с конкретным выбранным сверстником
 *    по пяти измерениям: совместность (`companionship`), конфликт (`conflict`,
 *    обратный ключ в общем индексе), помощь (`help`), защищённость (`security`)
 *    и близость (`closeness`). Это дополнительный исследовательский срез для
 *    линеек 8–10 и 11–13 (для 5–7 — только в адаптированном интервью с исследователем),
 *    а не оценка климата всей группы и не диагностика ребёнка.
 *  - Рабочий русскоязычный бланк требует расчёта внутренней согласованности
 *    (α Кронбаха) на пилотной выборке ВУЗа — модуль считает α автоматически.
 *  - В БД и выгрузках хранится только необратимый `participant_hash`, без ФИО
 *    ребёнка и без имени названного друга.
 */
import type { AgeBand } from '../types.ts';
import type { ResearchStage } from './coding.ts';

export type FqsDimensionId =
  | 'companionship'
  | 'conflict'
  | 'help'
  | 'security'
  | 'closeness';

export type FqsLikertScore = 1 | 2 | 3 | 4 | 5;

export type FqsItemSpec = {
  id: string;
  dimension: FqsDimensionId;
  reverseInComposite: boolean;
  prompt: string;
};

export const FQS_DIMENSIONS: readonly {
  id: FqsDimensionId;
  label: string;
  reverseInComposite: boolean;
  description: string;
}[] = [
  {
    id: 'companionship',
    label: 'Совместность (Companionship)',
    reverseInComposite: false,
    description: 'Добровольное совместное время и общие занятия со сверстником.',
  },
  {
    id: 'conflict',
    label: 'Конфликтность (Conflict, обратная шкала)',
    reverseInComposite: true,
    description: 'Частота споров и разногласий (в сводном индексе инвертируется: 6 − балл).',
  },
  {
    id: 'help',
    label: 'Помощь и выручка (Help)',
    reverseInComposite: false,
    description: 'Готовность прийти на помощь и поделиться в трудной задаче.',
  },
  {
    id: 'security',
    label: 'Надёжность и доверие (Security)',
    reverseInComposite: false,
    description: 'Уверенность, что дружба выдержит ошибку или временную ссору.',
  },
  {
    id: 'closeness',
    label: 'Эмоциональная близость (Closeness)',
    reverseInComposite: false,
    description: 'Ощущение принятия, тепла и значимости отношений.',
  },
] as const;

export const FQS_ITEMS: readonly FqsItemSpec[] = [
  {
    id: 'comp_1',
    dimension: 'companionship',
    reverseInComposite: false,
    prompt: 'Мы с моим другом по собственному желанию проводим свободное время вместе.',
  },
  {
    id: 'comp_2',
    dimension: 'companionship',
    reverseInComposite: false,
    prompt: 'Мы часто придумываем общие игры, истории или дела на перемене и после занятий.',
  },
  {
    id: 'comp_3',
    dimension: 'companionship',
    reverseInComposite: false,
    prompt: 'Нам интересно делать совместные задания в паре.',
  },
  {
    id: 'conf_1',
    dimension: 'conflict',
    reverseInComposite: true,
    prompt: 'Мы с другом часто спорим и сердимся друг на друга.',
  },
  {
    id: 'conf_2',
    dimension: 'conflict',
    reverseInComposite: true,
    prompt: 'Нам бывает трудно договориться, и из-за мелочей возникает размолвка.',
  },
  {
    id: 'conf_3',
    dimension: 'conflict',
    reverseInComposite: true,
    prompt: 'Мы можем перебивать или задевать друг друга, когда не согласны.',
  },
  {
    id: 'help_1',
    dimension: 'help',
    reverseInComposite: false,
    prompt: 'Если у меня что-то не получается, друг старается подсказать и помочь.',
  },
  {
    id: 'help_2',
    dimension: 'help',
    reverseInComposite: false,
    prompt: 'Друг заступится или поддержит меня, если рядом возникла неловкая ситуация.',
  },
  {
    id: 'help_3',
    dimension: 'help',
    reverseInComposite: false,
    prompt: 'Мы спокойно делимся материалами и уступаем очередь в общем деле.',
  },
  {
    id: 'sec_1',
    dimension: 'security',
    reverseInComposite: false,
    prompt: 'Если между нами случилась ошибка или спор, мы умеем помириться.',
  },
  {
    id: 'sec_2',
    dimension: 'security',
    reverseInComposite: false,
    prompt: 'Если мне тревожно или грустно, я могу сказать об этом другу без страха насмешки.',
  },
  {
    id: 'sec_3',
    dimension: 'security',
    reverseInComposite: false,
    prompt: 'Я знаю, что друг сохранит доверенный разговор и не использует его против меня.',
  },
  {
    id: 'clos_1',
    dimension: 'closeness',
    reverseInComposite: false,
    prompt: 'Рядом с другом я чувствую себя спокойно и уверенно.',
  },
  {
    id: 'clos_2',
    dimension: 'closeness',
    reverseInComposite: false,
    prompt: 'Друг радуется, когда у меня получается что-то важное.',
  },
  {
    id: 'clos_3',
    dimension: 'closeness',
    reverseInComposite: false,
    prompt: 'Я чувствую, что наше общение важно для нас обоих.',
  },
] as const;

export const FQS_PROTOCOL = {
  version: 'gib-fqs-1.0',
  reference: 'Bukowski, W. M., Hoza, B., & Boivin, M. (1994). Measuring friendship quality during pre- and early adolescence: The development and psychometric properties of the Friendship Quality Scale.',
  scaleAnchors: {
    1: 'Совсем не про нас',
    2: 'Скорее не про нас',
    3: 'Бывает по-разному',
    4: 'Скорее про нас',
    5: 'Точно про нас',
  } as Record<FqsLikertScore, string>,
  dimensions: FQS_DIMENSIONS,
  items: FQS_ITEMS,
  caveat:
    'Рабочий исследовательский бланк по мотивам FQS (Bukowski et al., 1994) оценивает диадную дружбу с одним выбранным сверстником, не является клинической диагностикой и требует проверки внутренней согласованности (α Кронбаха) на пилотной выборке ВУЗа.',
} as const;

export type FqsSubscaleScores = Record<FqsDimensionId, number>;

export type FqsResponseRecord = {
  responseId: string;
  profileId?: string | null;
  participantHash: string;
  ageBand: AgeBand;
  stage: ResearchStage;
  lesson?: number | null;
  items: Record<string, FqsLikertScore>;
  subscales: FqsSubscaleScores;
  /** Среднее по 15 пунктам с инверсией шкалы конфликта (`6 - score`). */
  compositeMean: number;
  createdAt: number;
};

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function isValidFqsScore(v: unknown): v is FqsLikertScore {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

export function parseAndScoreFqsItems(
  raw: Record<string, unknown>,
): { ok: true; items: Record<string, FqsLikertScore>; subscales: FqsSubscaleScores; compositeMean: number } | { ok: false; error: string } {
  const items: Record<string, FqsLikertScore> = {};
  for (const spec of FQS_ITEMS) {
    const val = Number(raw[spec.id]);
    if (!isValidFqsScore(val)) {
      return { ok: false, error: `invalid_item_${spec.id}` };
    }
    items[spec.id] = val;
  }

  const subscales = {} as FqsSubscaleScores;
  for (const dim of FQS_DIMENSIONS) {
    const dimItems = FQS_ITEMS.filter((i) => i.dimension === dim.id);
    const mean = dimItems.reduce((acc, i) => acc + items[i.id], 0) / dimItems.length;
    subscales[dim.id] = round4(mean);
  }

  const directionalSum = FQS_ITEMS.reduce((acc, spec) => {
    const val = items[spec.id];
    return acc + (spec.reverseInComposite ? 6 - val : val);
  }, 0);

  return {
    ok: true,
    items,
    subscales,
    compositeMean: round4(directionalSum / FQS_ITEMS.length),
  };
}

function sampleVariance(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return sq / (n - 1);
}

/**
 * Коэффициент внутренней согласованности α Кронбаха:
 * α = (k / (k - 1)) * (1 - Σ Var(item_i) / Var(total)).
 * Возвращает `null`, если наблюдений меньше 3 или дисперсия суммарного балла нулевая.
 */
export function computeCronbachAlpha(matrix: readonly (readonly number[])[]): number | null {
  const n = matrix.length;
  if (n < 3) return null;
  const k = matrix[0]?.length ?? 0;
  if (k < 2) return null;

  const totals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const totalVar = sampleVariance(totals);
  if (totalVar <= 1e-12) return null;

  let sumItemVar = 0;
  for (let col = 0; col < k; col++) {
    sumItemVar += sampleVariance(matrix.map((row) => row[col]));
  }
  const alpha = (k / (k - 1)) * (1 - sumItemVar / totalVar);
  return round4(Math.max(-1, Math.min(1, alpha)));
}

export type FqsSummaryReport = {
  totalResponses: number;
  uniqueParticipants: number;
  cronbachAlphaOverall: number | null;
  cronbachAlphaByDimension: Record<FqsDimensionId, number | null>;
  byStage: Record<
    ResearchStage,
    {
      count: number;
      compositeMean: number | null;
      subscales: Record<FqsDimensionId, number | null>;
    }
  >;
  pairedEntryToFinal: {
    participantsCount: number;
    deltaCompositeMean: number | null;
    deltaByDimension: Record<FqsDimensionId, number | null>;
  };
};

function emptySubscaleNullable(): Record<FqsDimensionId, number | null> {
  return {
    companionship: null,
    conflict: null,
    help: null,
    security: null,
    closeness: null,
  };
}

export function summarizeFqsResponses(responses: readonly FqsResponseRecord[]): FqsSummaryReport {
  const uniqueParticipants = new Set(responses.map((r) => r.participantHash)).size;

  const overallMatrix = responses.map((r) =>
    FQS_ITEMS.map((spec) => {
      const v = r.items[spec.id] ?? 3;
      return spec.reverseInComposite ? 6 - v : v;
    }),
  );
  const cronbachAlphaOverall = computeCronbachAlpha(overallMatrix);

  const cronbachAlphaByDimension = emptySubscaleNullable();
  for (const dim of FQS_DIMENSIONS) {
    const specs = FQS_ITEMS.filter((i) => i.dimension === dim.id);
    cronbachAlphaByDimension[dim.id] = computeCronbachAlpha(
      responses.map((r) => specs.map((sp) => r.items[sp.id] ?? 3)),
    );
  }

  const byStage: FqsSummaryReport['byStage'] = {
    entry: { count: 0, compositeMean: null, subscales: emptySubscaleNullable() },
    mid: { count: 0, compositeMean: null, subscales: emptySubscaleNullable() },
    final: { count: 0, compositeMean: null, subscales: emptySubscaleNullable() },
  };

  for (const st of ['entry', 'mid', 'final'] as const) {
    const list = responses.filter((r) => r.stage === st);
    byStage[st].count = list.length;
    if (list.length > 0) {
      byStage[st].compositeMean = round4(
        list.reduce((acc, r) => acc + r.compositeMean, 0) / list.length,
      );
      for (const dim of FQS_DIMENSIONS) {
        byStage[st].subscales[dim.id] = round4(
          list.reduce((acc, r) => acc + (r.subscales[dim.id] ?? 0), 0) / list.length,
        );
      }
    }
  }

  // Парная продольная дельта (final − entry) для участников, заполнивших оба среза.
  const latestByHashAndStage = new Map<string, FqsResponseRecord>();
  for (const r of [...responses].sort((a, b) => a.createdAt - b.createdAt)) {
    latestByHashAndStage.set(`${r.participantHash}:${r.stage}`, r);
  }
  const pairedHashes: { entry: FqsResponseRecord; final: FqsResponseRecord }[] = [];
  for (const hash of new Set(responses.map((r) => r.participantHash))) {
    const entry = latestByHashAndStage.get(`${hash}:entry`);
    const fin = latestByHashAndStage.get(`${hash}:final`);
    if (entry && fin) pairedHashes.push({ entry, final: fin });
  }

  const deltaByDimension = emptySubscaleNullable();
  let deltaCompositeMean: number | null = null;
  if (pairedHashes.length > 0) {
    deltaCompositeMean = round4(
      pairedHashes.reduce((acc, p) => acc + (p.final.compositeMean - p.entry.compositeMean), 0) /
        pairedHashes.length,
    );
    for (const dim of FQS_DIMENSIONS) {
      deltaByDimension[dim.id] = round4(
        pairedHashes.reduce(
          (acc, p) => acc + ((p.final.subscales[dim.id] ?? 0) - (p.entry.subscales[dim.id] ?? 0)),
          0,
        ) / pairedHashes.length,
      );
    }
  }

  return {
    totalResponses: responses.length,
    uniqueParticipants,
    cronbachAlphaOverall,
    cronbachAlphaByDimension,
    byStage,
    pairedEntryToFinal: {
      participantsCount: pairedHashes.length,
      deltaCompositeMean,
      deltaByDimension,
    },
  };
}
