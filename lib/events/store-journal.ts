import { validateEvent, pruneExpired, type EventError, type EventJournal, type LearningEvent, type StoredEvent } from './journal';

/**
 * Постоянный журнал поверх общего хранилища (JSON-файл или SQLite через `store`).
 *
 * Зачем: события из памяти процесса терялись при рестарте, а отчёт и повторение
 * должны переживать перезапуск. Запись идёт через тот же `transaction`, что и
 * прогресс, поэтому «изменение без события» не появляется и наоборот.
 *
 * Чего здесь нет намеренно:
 * - идентификатора родителя (владельца) внутри события — владелец хранится рядом
 *   и служит только фильтром доступа;
 * - содержимого ответов, имён, initData и отметок чувств — см. каталог;
 * - отдельной аналитики: это технический журнал, не отчёт о личности ребёнка.
 */

/**
 * Что журналу нужно от хранилища.
 *
 * Только адресные операции, без чтения всего состояния: в режиме PostgreSQL
 * `store.all()` поднял бы все таблицы ради одной строки журнала. Транзакция
 * по-прежнему общая с прогрессом — это и есть смысл журнала.
 */
type StoreLike = {
  transaction<T>(fn: () => T): T;
  eventByDedupe(dedupeKey: string): StoredEvent | undefined;
  addEvent(event: StoredEvent): void;
  eventsForOwner(ownerId: string, profileId: string): StoredEvent[];
  removeEventsForProfile(profileId: string): number;
  pruneEvents(now: number): number;
  eventCount(): number;
  /** Сохранить после изменения вне транзакции (JSON-режим). */
  save?(): void;
};

export type PersistentJournal = EventJournal & {
  /** Явная запись изменений (нужна для JSON-хранилища вне транзакции). */
  flush(): void;
  /** Сколько событий отброшено по сроку хранения. */
  prune(now?: number): number;
};

/**
 * @param persistOk Проверка, что владелец профиля действительно владелец:
 *   журнал не должен принимать записи за чужой профиль даже по ошибке в коде.
 */
export function createStoreJournal(store: StoreLike, options: { persistOk?: (ownerId: string, profileId: string) => boolean } = {}): PersistentJournal {
  let lastError: EventError | null = null;

  const journal: PersistentJournal = {
    append(ownerId, profileId, dedupeKey, event, at = Date.now()) {
      const checked = validateEvent(event);
      if (!checked.ok) { lastError = checked.error; return { ok: false, error: checked.error }; }
      if (!/^[a-zA-Z0-9_:-]{1,120}$/.test(dedupeKey)) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      if (!/^[a-zA-Z0-9_:-]{1,80}$/.test(ownerId) || !/^[a-zA-Z0-9_:-]{1,80}$/.test(profileId)) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      if (options.persistOk && !options.persistOk(ownerId, profileId)) { lastError = 'invalid_event'; return { ok: false, error: 'invalid_event' }; }
      const result = store.transaction(() => {
        const existing = store.eventByDedupe(dedupeKey);
        // Повтор того же шага не создаёт второе событие; подмена профиля отклоняется.
        if (existing) return existing.profileId === profileId && existing.ownerId === ownerId
          ? { ok: true as const, stored: existing }
          : { ok: false as const, error: 'duplicate_key' as const };
        const stored: StoredEvent = { id: `e_${dedupeKey.length}_${dedupeKey}`, profileId, ownerId, at, dedupeKey, event: checked.event };
        store.addEvent(stored);
        return { ok: true as const, stored };
      });
      if (!result.ok) lastError = result.error; else lastError = null;
      return result;
    },

    list(ownerId, profileId) {
      // Чужой владелец не видит ничего, даже при совпадении profileId.
      return store.eventsForOwner(ownerId, profileId);
    },

    removeProfile(profileId) {
      return store.transaction(() => store.removeEventsForProfile(profileId));
    },

    size: () => store.eventCount(),
    lastError: () => lastError,
    flush: () => { store.save?.(); },
    prune(now = Date.now()) {
      return store.transaction(() => store.pruneEvents(now));
    },
  };
  return journal;
}

/** Читает журнал владельца и отдаёт безопасную копию без внутреннего хранилища. */
export function eventsForOwner(journal: EventJournal, ownerId: string, profileId: string): StoredEvent[] {
  return journal.list(ownerId, profileId).map(e => ({ ...e, event: e.event as LearningEvent }));
}
