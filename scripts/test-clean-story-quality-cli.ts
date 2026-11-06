import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { detectSourceKind } from './clean-story-quality.ts';
import { cleanStoryQuality } from '../lib/story-quality-cleanup.ts';
import { validateStore } from '../lib/store-validation.ts';
import { openDetachedBridge, ensureSchemaSync, readState, writeState } from '../lib/postgres/state-backend.ts';
import { SCHEMA_V1, SCHEMA_V2 } from '../lib/postgres/schema.ts';

const tsx = path.join('node_modules', '.bin', 'tsx');
const cli = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(tsx, ['scripts/clean-story-quality.ts', ...args], { encoding: 'utf8', cwd: process.cwd(), env: { ...process.env, ...env }, timeout: 120_000 });

/** Отчёт — первый JSON-объект в выводе; после него идёт человеческая строка. */
function reportOf(stdout: string): { kind: string; mode: string; counts: Record<string, number> } {
  // Отчёт заканчивается строкой с единственной закрывающей скобкой.
  const end = stdout.indexOf('\n}\n');
  if (end < 0) {
    const error = /Error|ошиб|usage/i.test(stdout) ? stdout.trim().slice(0, 200) : 'вывод пуст';
    throw new Error(`в выводе нет отчёта (${error})`);
  }
  return JSON.parse(stdout.slice(0, end + 2));
}

const profile = { id: 'p', parentId: 'owner', name: 'Тест', age: 9, band: '8-10', createdAt: 1 };
const makeAnswer = () => ({ scenarioId: 'w1d1', competency: 'self_awareness', choice: 0, quality: 'bad' });
const snap = {
  id: 'w1d1', competency: 'self_awareness', skillLabel: 'Тема',
  variants: Object.fromEntries(['5-7', '8-10', '11-13'].map(band => [band, { title: 'История', text: 'Ситуация', options: [{ text: 'Вариант', note: 'Комментарий', quality: 'bad' }] }])),
};
const receipt = { step: 3, fingerprint: 'receipt-secret', result: { done: true, summary: { scenarioQuality: 'bad', tasks: 3, correct: 2, stars: 2, comboBest: 1 } } };
const state = {
  profiles: [profile], skills: [], subs: [], programStates: [], playerStates: [], payments: [],
  sessions: [
    { id: 'finished', profileId: 'p', startedAt: 1, finishedAt: 2, seconds: 1, tasks: [], plan: ['scenario:w1d1'], scenario: makeAnswer(), lastReceipt: structuredClone(receipt) },
    { id: 'active', profileId: 'p', startedAt: 1, seconds: 0, tasks: [], plan: ['scenario:w1d1'], runtime: { sessionId: 'active', profileId: 'p', index: 0, plan: [{ type: 'scenario', scenarioId: 'w1d1' }], items: [{ type: 'scenario', scenarioId: 'w1d1', order: [0], content: structuredClone(snap) }], scenarioAnswer: makeAnswer() }, lastReceipt: structuredClone(receipt) },
  ],
  extra: { keep: 'quality:private-sentinel' },
};
validateStore(state);
const expected = cleanStoryQuality(state, { deferActive: false }).state;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-cli-'));

/* ---- 1. JSON: формат по содержимому, копия, исходник цел ---- */
{
  const source = path.join(dir, 'db.json');
  fs.writeFileSync(source, JSON.stringify(state, null, 2));
  assert.equal(detectSourceKind(source), 'json');

  const preview = cli(['--dry-run', source]);
  assert.equal(preview.status, 0, preview.stderr);
  const previewReport = reportOf(preview.stdout);
  assert.equal(previewReport.counts.finishedLabelsRemoved, 1);
  assert.equal(previewReport.counts.receiptLabelsRemoved, 2);
  assert.equal(previewReport.counts.activeSnapshotsRemoved, 1);
  assert.ok(!preview.stdout.includes('private-sentinel'), 'в отчёт не попадают значения');
  assert.ok(!preview.stdout.includes('receipt-secret'), 'в отчёт не попадают отпечатки');
  assert.equal(fs.readFileSync(source, 'utf8'), JSON.stringify(state, null, 2), 'сухой прогон не меняет исходник');

  const target = path.join(dir, 'clean.json');
  const copy = cli(['--copy', source, target]);
  assert.equal(copy.status, 0, copy.stderr);
  const written = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(written, expected);
  assert.equal((written.extra as Record<string, string>).keep, 'quality:private-sentinel');
  assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'копия только для владельца');
  assert.equal(fs.readFileSync(source, 'utf8'), JSON.stringify(state, null, 2), 'исходник не тронут');

  // Повтор поверх той же копии запрещён: не перезаписываем молча.
  assert.notEqual(cli(['--copy', source, target]).status, 0);
  // Запись поверх исходника запрещена.
  assert.notEqual(cli(['--copy', source, source]).status, 0);
  // Второй прогон по очищенной копии ничего не находит — идемпотентность.
  const second = cli(['--dry-run', target]);
  assert.equal(second.status, 0, second.stderr);
  const secondReport = reportOf(second.stdout);
  assert.equal(secondReport.counts.finishedLabelsRemoved, 0);
  assert.equal(secondReport.counts.receiptLabelsRemoved, 0);
  console.log('  ok JSON: формат по содержимому, копия, повтор и защита исходника');
}

/* ---- 2. SQLite через общий CLI ---- */
{
  const source = path.join(dir, 'db.sqlite');
  const db = new DatabaseSync(source);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  db.prepare('INSERT INTO app_state VALUES(1,?)').run(JSON.stringify(state));
  db.close();
  assert.equal(detectSourceKind(source), 'sqlite');

  const preview = cli(['--dry-run', source]);
  assert.equal(preview.status, 0, preview.stderr);
  const target = path.join(dir, 'clean.sqlite');
  const copy = cli(['--copy', source, target]);
  assert.equal(copy.status, 0, copy.stderr);
  const clone = new DatabaseSync(target, { readOnly: true });
  const data = JSON.parse(String((clone.prepare('SELECT data FROM app_state WHERE id=1').get() as { data: string }).data));
  clone.close();
  assert.deepEqual(data, expected);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  console.log('  ok SQLite: тот же CLI, та же очистка, тот же результат');
}

/* ---- 3. Неизвестный формат не угадывается ---- */
{
  const junk = path.join(dir, 'junk.bin');
  fs.writeFileSync(junk, 'это не база и не состояние');
  assert.throws(() => detectSourceKind(junk), /unknown_source_format/);
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{"profiles":[],"sessions":[null]}');
  assert.notEqual(cli(['--copy', bad, path.join(dir, 'bad-out.json')]).status, 0, 'битое состояние не публикуется');
  assert.equal(fs.existsSync(path.join(dir, 'bad-out.json')), false);
  console.log('  ok неизвестный формат и битое состояние не превращаются в копию');
}

/* ---- 4. PostgreSQL: копия в отдельной схеме, исходник цел ---- */
{
  const pgDir = path.join(dir, 'pg');
  const env = { ...process.env, GIB_STORE: 'postgres', GIB_PG_DIR: pgDir, GIB_POSTGRES_URL: '', DATABASE_URL: '' };
  // Наполняем базу тем же кодом, что и приложение.
  const bridge = openDetachedBridge(env);
  try {
    ensureSchemaSync(bridge, { v1: SCHEMA_V1, v2: SCHEMA_V2 });
    const empty = readState(bridge);
    writeState(bridge, empty, { ...empty, ...state } as never);
  } finally {
    bridge.close();
  }

  const preview = cli(['--dry-run', '--postgres'], env);
  assert.equal(preview.status, 0, preview.stderr);
  const report = reportOf(preview.stdout);
  assert.equal(report.kind, 'postgres');
  assert.equal(report.counts.finishedLabelsRemoved, 1);
  assert.equal(report.counts.receiptLabelsRemoved, 2);
  assert.ok(!preview.stdout.includes('receipt-secret'), 'в отчёт не попадают отпечатки');

  const copyRun = cli(['--copy', '--postgres', 'gib_cleaned'], env);
  assert.equal(copyRun.status, 0, copyRun.stderr);

  const check = openDetachedBridge(env);
  try {
    const original = readState(check);
    const copy = readState(check, 'gib_cleaned');
    assert.ok(JSON.stringify(original).includes('"quality"'), 'исходная схема осталась как была');
    assert.ok(!JSON.stringify(copy).includes('"quality"'), 'копия без меток в снимках и ответах');
    assert.equal(copy.sessions.length, original.sessions.length, 'ни одна сессия не потеряна');
    assert.deepEqual(copy.profiles, original.profiles, 'профили не изменились');
    const cleanedCopy = cleanStoryQuality(copy, { deferActive: false });
    assert.equal(cleanedCopy.counts.finishedLabelsRemoved + cleanedCopy.counts.receiptLabelsRemoved + cleanedCopy.counts.activeSnapshotsRemoved + cleanedCopy.counts.activeLabelsRemoved, 0, 'копия действительно чистая');
  } finally {
    check.close();
  }
  // Имя схемы проверяется: подставить произвольный SQL нельзя.
  assert.notEqual(cli(['--copy', '--postgres', 'gib; DROP TABLE gib.profiles'], env).status, 0);
  console.log('  ok PostgreSQL: копия в отдельной схеме без меток, исходник цел, имя схемы проверено');
}

fs.rmSync(dir, { recursive: true, force: true });
