/**
 * Аварийное восстановление: план, отчёт, честные отказы.
 *
 * Проверяется то, что важно при аварии: процедура полная и по порядку,
 * битая копия не проходит приёмку, а отчёт говорит, что именно не так.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RESTORE_PLAN, restoreReportText, verifyRestoredFile } from '../lib/restore-plan';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-restore-'));

async function main() {
  // 1. План полный, по порядку и с объяснением каждого шага.
  assert.ok(RESTORE_PLAN.length >= 5, 'шагов восстановления достаточно');
  assert.equal(RESTORE_PLAN[0].id, 'stop', 'сначала остановка сервиса, а не копирование поверх');
  assert.equal(RESTORE_PLAN[1].id, 'keep', 'прежнее состояние сохраняется, а не удаляется');
  assert.ok(RESTORE_PLAN.every(s => s.title && s.detail.length > 20), 'у каждого шага есть объяснение');
  assert.ok(RESTORE_PLAN.some(s => s.id === 'switch'), 'есть шаг подключения');
  assert.ok(RESTORE_PLAN.some(s => s.id === 'check'), 'есть шаг приёмки');
  const ids = RESTORE_PLAN.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'шаги не дублируются');
  console.log('  ok план восстановления полный и по порядку');

  // 2. Годная база проходит проверку.
  const good = path.join(dir, 'good.sqlite');
  const db = new DatabaseSync(good);
  db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  db.prepare('INSERT INTO app_state (id, data) VALUES (1, ?)').run(JSON.stringify({ profiles: [], parentPins: [], familySettings: [], notificationSettings: [] }));
  db.close();
  const report = verifyRestoredFile(good);
  assert.equal(report.ok, true, `годная копия проходит: ${JSON.stringify(report.checks)}`);
  assert.ok(report.bytes > 0);
  assert.ok(report.checks.some(c => c.id === 'sqlite' && c.ok), 'целостность страниц проверена');
  assert.ok(report.checks.some(c => c.id === 'state' && c.ok), 'состояние найдено');
  console.log('  ok годная копия проходит проверку');

  // 3. Битый файл не проходит и объясняет причину.
  const broken = path.join(dir, 'broken.sqlite');
  fs.writeFileSync(broken, 'это не база данных, а текст');
  const bad = verifyRestoredFile(broken);
  assert.equal(bad.ok, false, 'битый файл отклонён');
  assert.ok(bad.checks.some(c => !c.ok && /целостн|прочитать|мал/i.test(c.detail)), 'причина названа');
  console.log('  ok битая копия отклоняется с причиной');

  // 4. Пустой файл отклоняется как «слишком мал».
  const empty = path.join(dir, 'empty.sqlite');
  fs.writeFileSync(empty, '');
  const emptyReport = verifyRestoredFile(empty);
  assert.equal(emptyReport.ok, false);
  assert.ok(emptyReport.checks.some(c => !c.ok && /мал|пуст/i.test(c.detail)), 'пустая копия названа пустой');
  console.log('  ok пустая копия отклоняется');

  // 5. Отсутствующий файл не роняет проверку.
  const missing = verifyRestoredFile(path.join(dir, 'nope.sqlite'));
  assert.equal(missing.ok, false);
  assert.ok(missing.checks.some(c => !c.ok && /нет/i.test(c.detail)));
  console.log('  ok отсутствующий файл объясняется словами');

  // 6. База без состояния приложения отклоняется: это «не та копия».
  const noState = path.join(dir, 'nostate.sqlite');
  const db2 = new DatabaseSync(noState);
  db2.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  db2.close();
  const noStateReport = verifyRestoredFile(noState);
  assert.equal(noStateReport.ok, false, 'база без состояния не принимается');
  assert.ok(noStateReport.checks.some(c => !c.ok && /Состояния/.test(c.detail)), 'сказано, чего не хватает');
  console.log('  ok копия без состояния приложения отклоняется');

  // 7. Отчёт читается человеком: итог, галочки, план.
  const text = restoreReportText(report);
  assert.ok(text.includes('Итог: копию можно подключать'), 'итог прямо сказан');
  assert.ok(text.includes('✓'), 'проверки видны');
  assert.ok(text.includes('Дальше по плану'), 'план приложен');
  assert.ok(text.includes('Остановить сервис'), 'первый шаг назван');
  const badText = restoreReportText(bad);
  assert.ok(badText.includes('Итог: копию подключать нельзя'), 'плохая копия прямо запрещена');
  assert.ok(!/пароль|ключ:/i.test(text), 'секретов в отчёте нет');
  console.log('  ok отчёт понятен человеку и не раскрывает секретов');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ok восстановление: план, приёмка, отказы, отчёт');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
