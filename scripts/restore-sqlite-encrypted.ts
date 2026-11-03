/** Offline restore only: never write into a live database or replace a file. */
import fs from 'node:fs';
import path from 'node:path';
import { backupKeyFromEnvironment, decryptFile } from '../lib/encrypted-backup.ts';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';

const [sourceArg, targetArg, ...extra] = process.argv.slice(2);
if (!sourceArg || !targetArg || extra.length) throw new Error('Usage: npm run restore:encrypted -- <backup.gib> <new-restored.sqlite>');
const key = backupKeyFromEnvironment(process.env.GIB_BACKUP_KEY_HEX);
const source = path.resolve(sourceArg); const target = path.resolve(targetArg);
let tmpdir: string | undefined;
try {
  if (source === target || !fs.statSync(source).isFile()) throw new Error('Invalid source or destination');
  // Stale WAL or journal files could be applied to an otherwise valid restored DB.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.lstatSync(target + suffix); throw new Error('Destination or SQLite sidecar already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  tmpdir = fs.mkdtempSync(path.join(path.dirname(target), '.gib-secure-restore-'));
  const snapshot = path.join(tmpdir, 'restored.sqlite');
  await decryptFile(source, snapshot, key); // plaintext is never published before authentication
  verifySqliteSnapshot(snapshot);
  const fd = fs.openSync(snapshot, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // These checks are for an offline, administrator-controlled directory, not adversarial concurrency.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { fs.lstatSync(target + suffix); throw new Error('SQLite sidecar already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  fs.linkSync(snapshot, target);
  console.log('Снимок проверен и восстановлен в новый файл. Не подключайте его к живому серверу без плана восстановления.');
} finally {
  key.fill(0);
  if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
}
