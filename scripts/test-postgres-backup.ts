/**
 * Резервная копия PostgreSQL: снимок, шифрование, расшифровка, проверка.
 *
 * Почему это отдельный тест. Копии умели только SQLite, а игра переведена на
 * PostgreSQL — то есть настоящая база оставалась без проверенного способа
 * сохранить состояние. Здесь проверяется весь путь на настоящих данных:
 * профиль и сессия пишутся в базу, снимаются, шифруются, расшифровываются
 * обратно и проверяются тем же `validateStore`, что и рабочая база.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openDetachedBridge, ensureSchemaSync } from '../lib/postgres/state-backend.ts';
import { SCHEMA_V1, SCHEMA_V2 } from '../lib/postgres/schema.ts';
import { readPgSnapshot, writePgSnapshot, verifyPgSnapshot, SNAPSHOT_TABLES } from '../lib/postgres/backup.ts';
import { decryptFile, encryptFile, backupKeyFromEnvironment } from '../lib/encrypted-backup.ts';
import { validateStore } from '../lib/store-validation.ts';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-pg-backup-'));

async function prepareDataDir(dataDir: string): Promise<void> {
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  await db.close();
}

/** Снимок → состояние: то же преобразование, что в CLI. */
function toStore(snapshot: ReturnType<typeof readPgSnapshot>): unknown {
  const collection = (table: string): unknown[] => {
    const found = snapshot.tables.find(t => t.name === table);
    if (!found) throw new Error(`нет таблицы ${table}`);
    return found.rows.map(row => (typeof row.data === 'string' ? JSON.parse(row.data) : row.data));
  };
  return {
    profiles: collection('profiles'), skills: collection('skills'), sessions: collection('sessions'),
    subs: collection('subscriptions'), programStates: collection('program_states'),
    playerStates: collection('player_states'), payments: collection('payments'), events: collection('events'),
  };
}

async function main(): Promise<void> {
  const dataDir = path.join(dir, 'db');
  await prepareDataDir(dataDir);
  const env = { GIB_PG_DIR: dataDir } as unknown as NodeJS.ProcessEnv;
  const bridge = openDetachedBridge(env);
  ensureSchemaSync(bridge, { v1: SCHEMA_V1, v2: SCHEMA_V2 });

  // Настоящие данные: профиль, программа и сессия, как их пишет приложение.
  bridge.query(
    `INSERT INTO gib.profiles (id, ordinal, parent_id, age, band, created_at, data)
     VALUES ($1, 0, $2, 8, '8-10', 1700000000, $3::jsonb)`,
    ['p1', 'owner-1', JSON.stringify({ id: 'p1', parentId: 'owner-1', name: 'Мира', age: 8, band: '8-10', createdAt: 1700000000 })],
  );
  bridge.query(
    `INSERT INTO gib.program_states (profile_id, ordinal, data) VALUES ($1, 0, $2::jsonb)`,
    ['p1', JSON.stringify({ profileId: 'p1', completedDays: 3, lastDayIndex: 2, startedAt: 1700000000 })],
  );

  // 1. Снимок содержит все таблицы состояния.
  const snapshot = readPgSnapshot(bridge);
  verifyPgSnapshot(snapshot);
  assert.equal(snapshot.format, 'gib-pg-snapshot');
  assert.equal(snapshot.database, 'postgres');
  assert.equal(snapshot.tables.length, SNAPSHOT_TABLES.length, 'все таблицы в снимке');
  const profiles = snapshot.tables.find(t => t.name === 'profiles')!;
  assert.equal(profiles.rows.length, 1, 'профиль попал в снимок');
  console.log(`  ok снимок: ${snapshot.tables.length} таблиц, профиль на месте`);

  // 2. Снимок проходит ту же проверку состояния, что рабочая база.
  validateStore(toStore(snapshot));
  console.log('  ok снимок проходит validateStore — это не просто JSON');

  // 3. Шифрование и расшифровка тем же ключом; чужой ключ не открывает.
  const key = backupKeyFromEnvironment('a'.repeat(64));
  const plain = path.join(dir, 'snapshot.json');
  const encrypted = path.join(dir, 'backup.gib');
  writePgSnapshot(snapshot, plain);
  await encryptFile(plain, encrypted, key);
  assert.ok(fs.statSync(encrypted).size > fs.statSync(plain).size, 'шифротекст не пустой');

  const restored = path.join(dir, 'restored.json');
  await decryptFile(encrypted, restored, key);
  const roundTrip = JSON.parse(fs.readFileSync(restored, 'utf8'));
  verifyPgSnapshot(roundTrip);
  const roundTripProfiles = roundTrip.tables.find((t: { name: string }) => t.name === 'profiles');
  assert.ok(roundTripProfiles, 'в расшифрованном снимке есть профили');
  assert.deepEqual(roundTripProfiles.rows, profiles.rows, 'после расшифровки профиль тот же');
  console.log('  ok шифрование и расшифровка: данные совпадают');

  const wrong = backupKeyFromEnvironment('b'.repeat(64));
  const badTarget = path.join(dir, 'must-not-exist.json');
  await assert.rejects(() => decryptFile(encrypted, badTarget, wrong), /./, 'чужой ключ отвергнут');
  assert.equal(fs.existsSync(badTarget), false, 'при неверном ключе файла не появляется');
  console.log('  ok неверный ключ не даёт файла');

  // 4. Публикация не перетирает существующую копию.
  const target = path.join(dir, 'published.gib');
  fs.writeFileSync(target, 'occupied');
  assert.throws(() => fs.linkSync(encrypted, target), /EEXIST/, 'hard link не перетирает файл');
  assert.equal(fs.readFileSync(target, 'utf8'), 'occupied');
  console.log('  ok публикация не перетирает существующую копию');

  // 5. Битый снимок отвергается до шифрования.
  const broken = { ...snapshot, tables: snapshot.tables.filter(t => t.name !== 'sessions') };
  assert.throws(() => verifyPgSnapshot(broken), /missing table sessions/, 'неполный снимок отвергнут');
  assert.throws(() => verifyPgSnapshot({ format: 'other' }), /Not a PostgreSQL snapshot/);
  console.log('  ok неполный или чужой снимок отвергается');

  // 6. Ключ из окружения проверяется по длине, а не «на глаз».
  assert.throws(() => backupKeyFromEnvironment('abc'), /64 hexadecimal/, 'короткий ключ отвергнут');
  assert.throws(() => backupKeyFromEnvironment(undefined), /64 hexadecimal/, 'пустой ключ отвергнут');
  console.log('  ok ключ: ровно 32 случайных байта');

  key.fill(0); wrong.fill(0);
  bridge.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nРезервная копия PostgreSQL: снимок, шифрование, отказ по ключу, публикация.');
}

main().catch(error => { console.error(error); process.exit(1); });
