/** Authenticated, encrypted SQLite snapshot. The key is supplied out of band. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { backupKeyFromEnvironment, encryptFile } from '../lib/encrypted-backup.ts';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';

const [sourceArg, targetArg, ...extra] = process.argv.slice(2);
if (!sourceArg || !targetArg || extra.length) throw new Error('Usage: npm run backup:encrypted -- <source.sqlite> <new-backup.gib>');
const key = backupKeyFromEnvironment(process.env.GIB_BACKUP_KEY_HEX);
const source = path.resolve(sourceArg); const target = path.resolve(targetArg);
let tmpdir: string | undefined;
let db: DatabaseSync | undefined;
try {
  if (source === target || !fs.statSync(source).isFile()) throw new Error('Invalid source or destination');
  tmpdir = fs.mkdtempSync(path.join(path.dirname(target), '.gib-secure-backup-'));
  const snapshot = path.join(tmpdir, 'snapshot.sqlite');
  const encrypted = path.join(tmpdir, 'encrypted.gib');
  db = new DatabaseSync(source, { readOnly: true });
  await backup(db, snapshot); db.close(); db = undefined;
  fs.chmodSync(snapshot, 0o600);
  verifySqliteSnapshot(snapshot);
  await encryptFile(snapshot, encrypted, key);
  const fd = fs.openSync(encrypted, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // Hard link publishes atomically and refuses to overwrite files or symlinks.
  fs.linkSync(encrypted, target);
  console.log('Зашифрованный снимок создан. Проверьте восстановление на отдельной копии.');
} finally {
  db?.close(); key.fill(0);
  if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
}
