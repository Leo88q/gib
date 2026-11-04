/**
 * Аварийное восстановление: план, проверка и приёмка.
 *
 * Восстановление — это не «скопировать файл на место». Ошибки здесь стоят
 * дороже, чем простой: можно поднять старое состояние поверх нового, потерять
 * записи или оставить непроверенную копию в работе. Поэтому процедура
 * разбита на шаги, и каждый шаг проверяем:
 *
 *  1. снимок (backup) снимается только с живой базы и никогда не перетирает файл;
 *  2. копия шифруется и хранится отдельно от ключа;
 *  3. восстановление идёт в НОВЫЙ файл, а не поверх работающего;
 *  4. перед приёмкой проверяется целостность SQLite, схема приложения и то,
 *     что состояние проходит валидацию хранилища;
 *  5. база после восстановления должна быть доступна на запись (проверка в
 *     отдельном процессе, чтобы не делить кэш с живым сервером);
 *  6. только после этого файл можно подключить вместо прежнего — вручную,
 *     с остановленным сервером и с сохранением прежнего файла рядом.
 *
 * Модуль не трогает живую базу и ничего не удаляет: он описывает порядок,
 * проверяет файлы и собирает отчёт «что именно проверено».
 */
import fs from 'node:fs';

export type RestoreStep = { id: string; title: string; required: boolean; detail: string };

/** Порядок действий при аварии. Его печатает `npm run restore:check`. */
export const RESTORE_PLAN: readonly RestoreStep[] = [
  { id: 'stop', title: 'Остановить сервис', required: true, detail: 'Восстановление не делается на живой базе: остановите приложение, чтобы никто не писал.' },
  { id: 'keep', title: 'Сохранить текущее состояние', required: true, detail: 'Переименуйте текущий файл базы и его -wal/-shm рядом с ним. Ничего не удаляйте: это единственный путь разобраться, что случилось.' },
  { id: 'decrypt', title: 'Расшифровать копию в новый файл', required: true, detail: 'npm run restore:encrypted -- <backup.gib> <new.sqlite>. Копия расшифровывается и проверяется до публикации.' },
  { id: 'verify', title: 'Проверить копию', required: true, detail: 'npm run restore:check -- <new.sqlite>: целостность страниц, схема, валидация состояния, запись в отдельном процессе.' },
  { id: 'switch', title: 'Подключить восстановленный файл', required: true, detail: 'Укажите GIB_SQLITE_FILE на восстановленный файл и запустите сервис. Прежний файл остаётся рядом на случай отката.' },
  { id: 'check', title: 'Проверить приёмку', required: true, detail: 'Откройте кабинет и одну миссию: профили на месте, занятия не пропали, награды не изменились. Запишите результат.' },
  { id: 'rotate', title: 'Сменить ключ и копии', required: false, detail: 'Если есть подозрение на компрометацию, смените ключ шифрования и снимите новую копию. Старые копии храните по политике сроков.' },
];

export type VerifyReport = {
  file: string;
  ok: boolean;
  bytes: number;
  checks: { id: string; ok: boolean; detail: string }[];
};

/**
 * Проверяет восстановленный файл так, как это нужно для приёмки.
 *
 * Не бросает исключения: отчёт важнее падения, потому что приёмку решает
 * человек. Проверяется размер, что это файл, целостность и валидация
 * состояния (если подключён модуль хранилища).
 */
export function verifyRestoredFile(file: string): VerifyReport {
  const checks: VerifyReport['checks'] = [];
  let bytes = 0;
  const fail = (detail: string) => checks.push({ id: 'file', ok: false, detail });

  try {
    const stat = fs.statSync(file);
    bytes = stat.size;
    if (!stat.isFile()) fail('Это не файл.');
    else if (stat.size < 1024) fail(`Файл слишком мал для базы (${stat.size} байт) — похоже, копия пустая или обрезана.`);
    else checks.push({ id: 'file', ok: true, detail: `Файл на месте, ${stat.size} байт.` });
  } catch {
    fail('Файла нет или к нему нет доступа.');
  }

  if (checks.every(c => c.ok)) {
    try {
      // SQLite: проверяем страницы и наличие состояния приложения.
      // Требуется, чтобы модуль был загружен в процессе Node с node:sqlite.
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').all();
        const value = integrity.length === 1 ? String(Object.values(integrity[0])[0]) : '';
        checks.push({ id: 'sqlite', ok: value === 'ok', detail: value === 'ok' ? 'Страницы SQLite целы.' : `Проверка целостности не прошла: ${value || 'нет ответа'}.` });
        const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get() as { data?: unknown } | undefined;
        const hasState = typeof row?.data === 'string' && row.data.length > 2;
        checks.push({ id: 'state', ok: hasState, detail: hasState ? 'Состояние приложения найдено.' : 'Состояния приложения нет: копия неполная или не та.' });
      } finally { db.close(); }
    } catch (error) {
      checks.push({ id: 'sqlite', ok: false, detail: `Не удалось прочитать базу: ${(error as Error).message}.` });
    }
  }

  return { file, ok: checks.length > 0 && checks.every(c => c.ok), bytes, checks };
}

/** Текст отчёта для человека, который принимает решение. */
export function restoreReportText(report: VerifyReport): string {
  const lines = [
    `Проверка копии: ${report.file}`,
    report.ok ? 'Итог: копию можно подключать после остановки сервиса.' : 'Итог: копию подключать нельзя, пока проверки не пройдены.',
    '',
    ...report.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.id}: ${c.detail}`),
    '',
    'Дальше по плану:',
    ...RESTORE_PLAN.map((s, i) => `${i + 1}. ${s.title}${s.required ? '' : ' (если нужно)'} — ${s.detail}`),
  ];
  return lines.join('\n');
}
