/** Exercises the actual pg driver over a local Unix socket to an isolated PGlite test engine. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { exportOwnedProfile, deleteOwnedProfile } from '../lib/postgres/profile-repository.ts';
import type { SqlClient } from '../lib/postgres/migrate.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-cli-'));
const db = new PGlite();
const server = new PGLiteSocketServer({ db, path: path.join(dir, '.s.PGSQL.5432') });
const url = `postgresql://test:test-password@localhost/test?host=${encodeURIComponent(dir)}`;
const secretMarker = 'PRIVATE_TEST_PROFILE';
const state = { profiles: [{ id: 'p1', parentId: 'parent', age: 8, band: '8-10', name: secretMarker, createdAt: 1 }], sessions: [], skills: [] };
const source = path.join(dir, 'source.json'); fs.writeFileSync(source, JSON.stringify(state));
const env = { ...process.env, GIB_POSTGRES_URL: url, GIB_POSTGRES_INSECURE_TEST: '1', GIB_POSTGRES_OFFLINE_IMPORT: '1' };
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); console.log('  ok', label); }
function run(args: string[], more: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const proc = spawn(process.execPath, ['--experimental-strip-types', 'scripts/migrate-postgres.ts', ...args], { env: { ...env, ...more }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; proc.stdout.on('data', d => { output += d; }); proc.stderr.on('data', d => { output += d; });
    proc.on('error', reject); proc.on('exit', code => resolve({ code, output }));
  });
}
try {
  await server.start();
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ profiles: [null], sessions: [] }));
  const invalid = await run(['--json', bad]);
  check(invalid.code !== 0 && !invalid.output.includes(secretMarker) && !invalid.output.includes('test-password'), 'повреждённый источник отклоняется без раскрытия содержимого и секрета');
  check((await db.query<{ value: unknown }>("SELECT to_regnamespace('gib') AS value")).rows[0].value === null, 'ошибочный источник не меняет назначение');
  check((await run(['--json', source], { GIB_POSTGRES_OFFLINE_IMPORT: '0' })).code !== 0, 'без подтверждения offline перенос не начинается');
  check((await run(['--json', source], { GIB_POSTGRES_URL: 'postgresql://user:secret@untrusted.example/db', GIB_POSTGRES_INSECURE_TEST: '1' })).code !== 0, 'небезопасный сетевой адрес отклонён');
  check((await run(['--json', source], { GIB_POSTGRES_INSECURE_TEST: '0' })).code !== 0, 'по умолчанию соединение без TLS не допускается');
  check((await run(['--json', source], { GIB_POSTGRES_URL: url + '&sslmode=disable' })).code !== 0, 'переопределение TLS в URL не допускается');
  const before = fs.readFileSync(source, 'utf8');
  const imported = await run(['--json', source]);
  check(imported.code === 0 && !imported.output.includes(secretMarker) && !imported.output.includes('test-password'), 'CLI переносит JSON через PostgreSQL-протокол, не раскрывая данные и ключи');
  check(fs.readFileSync(source, 'utf8') === before && (await db.query<{ n: number }>('SELECT count(*) AS n FROM gib.profiles')).rows[0].n === 1, 'исходный JSON не изменён, запись в назначении');
  check((await run(['--json', source])).code !== 0, 'повторный CLI-импорт отклонён');
  const pool = new pg.Pool({ connectionString: url, ssl: false });
  const connection = await pool.connect();
  try {
    const adapter: SqlClient = { query: async (sql, params) => connection.query(sql, params) };
    const mine = await exportOwnedProfile(adapter, 'parent', 'p1');
    const denied = await exportOwnedProfile(adapter, 'other-parent', 'p1');
    check(mine?.profile.name === secretMarker && denied === null, 'PostgreSQL-протокол: экспорт проверяет владельца');
    check(await deleteOwnedProfile(adapter, 'other-parent', 'p1') === 'not_found', 'PostgreSQL-протокол: чужое удаление отклонено');
    check(await deleteOwnedProfile(adapter, 'parent', 'p1') === 'deleted', 'PostgreSQL-протокол: владелец может удалить профиль без платежей');
  } finally { connection.release(); await pool.end(); }
  check((await run(['--json', source])).code !== 0, 'импорт старой копии запрещён и после удаления профиля');

  await db.exec('DROP SCHEMA gib CASCADE');
  const sqliteFile = path.join(dir, 'source.sqlite');
  const sqlite = new DatabaseSync(sqliteFile);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  sqlite.prepare('INSERT INTO app_state VALUES (1, ?)').run(JSON.stringify(state));
  try {
    const sqliteImport = await run(['--sqlite', sqliteFile]);
    check(sqliteImport.code === 0, 'CLI переносит проверенный SQLite-снимок с WAL');
    check(JSON.parse(String(sqlite.prepare('SELECT data FROM app_state WHERE id=1').get()?.data)).profiles[0].name === secretMarker, 'SQLite-источник не изменён');
    check((await db.query<{ n: number }>('SELECT count(*) AS n FROM gib.profiles')).rows[0].n === 1, 'SQLite-профиль оказался в PostgreSQL-таблице');
    check(!fs.readdirSync(dir).some(name => name.startsWith('.gib-postgres-import-')), 'обычная очистка временного снимка выполнена');
  } finally { sqlite.close(); }
} finally { await server.stop(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
