/**
 * Шифрованная резервная копия PostgreSQL.
 *
 * Тот же формат `GIBBAK01`, что у SQLite-копий: AES-256-GCM, ключ — 32
 * случайных байта из окружения, magic+nonce как AAD. Разница только в
 * источнике снимка: здесь он снимается мостом из `gib.*`, а не из файла.
 *
 * Запуск:
 *   GIB_BACKUP_KEY_HEX=<64 hex> GIB_POSTGRES_URL=postgres://… \
 *     npm run backup:postgres -- <new-backup.gib>
 *
 * Что проверяется до публикации:
 *  1. снимок читается целиком (все таблицы на месте);
 *  2. снимок проходит `verifyPgSnapshot` и валидацию состояния;
 *  3. файл шифруется и fsync-ается;
 *  4. публикация — hard link: существующая копия не перетирается.
 */
import fs from 'node:fs';
import path from 'node:path';
import { backupKeyFromEnvironment, encryptFile } from '../lib/encrypted-backup.ts';
import { openDetachedBridge } from '../lib/postgres/state-backend.ts';
import { readPgSnapshot, writePgSnapshot, verifyPgSnapshot, type PgSnapshot } from '../lib/postgres/backup.ts';
import { validateStore } from '../lib/store-validation.ts';

async function main(): Promise<void> {
  const [targetArg, ...extra] = process.argv.slice(2);
  if (!targetArg || extra.length) {
    throw new Error('Usage: npm run backup:postgres -- <new-backup.gib> (нужны GIB_BACKUP_KEY_HEX и GIB_POSTGRES_URL)');
  }
  const target = path.resolve(targetArg);
  if (fs.existsSync(target)) throw new Error('Target already exists: ' + target);
  const key = backupKeyFromEnvironment(process.env.GIB_BACKUP_KEY_HEX);
  const bridge = openDetachedBridge(process.env);
  let tmpdir: string | undefined;
  try {
    const snapshot = readPgSnapshot(bridge);
    verifyPgSnapshot(snapshot);
    // Состояние проверяется той же функцией, что пишет его в базу: битая
    // копия не должна дойти до шифрования и тем более до восстановления.
    validateStore(snapshotToStore(snapshot));
    tmpdir = fs.mkdtempSync(path.join(path.dirname(target), '.gib-pg-backup-'));
    const plain = path.join(tmpdir, 'snapshot.json');
    const encrypted = path.join(tmpdir, 'encrypted.gib');
    writePgSnapshot(snapshot, plain);
    await encryptFile(plain, encrypted, key);
    const fd = fs.openSync(encrypted, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(encrypted, target);
    const rows = snapshot.tables.reduce((sum, table) => sum + table.rows.length, 0);
    console.log(`Зашифрованный снимок PostgreSQL создан: ${snapshot.tables.length} таблиц, ${rows} строк.`);
    console.log('Проверьте восстановление на отдельной базе, прежде чем рассчитывать на копию.');
  } finally {
    key.fill(0);
    bridge.close();
    if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

/**
 * Снимок → форма состояния приложения.
 *
 * Нужно потому, что проверка целостности (`validateStore`) знает игру, а не
 * устройство таблиц. Строки в снимке лежат целиком в `data`, поэтому здесь
 * достаточно достать JSONB и разложить по коллекциям.
 */
function snapshotToStore(snapshot: PgSnapshot): unknown {
  const collection = (table: string): unknown[] => {
    const found = snapshot.tables.find(t => t.name === table);
    if (!found) throw new Error(`Snapshot is missing table ${table}`);
    return found.rows.map(row => {
      const data = row.data;
      if (data && typeof data === 'object') return data;
      if (typeof data === 'string') return JSON.parse(data);
      throw new Error(`Table ${table} row has no data`);
    });
  };
  return {
    profiles: collection('profiles'),
    skills: collection('skills'),
    sessions: collection('sessions'),
    subs: collection('subscriptions'),
    programStates: collection('program_states'),
    playerStates: collection('player_states'),
    payments: collection('payments'),
    events: collection('events'),
  };
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
