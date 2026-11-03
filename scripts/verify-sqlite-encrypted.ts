/** Verify authentication, SQLite pages and known app structure without publishing plaintext. */
import fs from 'node:fs';
import path from 'node:path';
import { backupKeyFromEnvironment, decryptFile } from '../lib/encrypted-backup.ts';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';
const [sourceArg, ...extra] = process.argv.slice(2);
if (!sourceArg || extra.length) throw new Error('Usage: npm run verify:encrypted -- <backup.gib>');
const key = backupKeyFromEnvironment(process.env.GIB_BACKUP_KEY_HEX);
let tmpdir: string | undefined;
try {
  const source = path.resolve(sourceArg);
  if (!fs.statSync(source).isFile()) throw new Error('Invalid source');
  // Offline operation: the parent directory must be trusted and on a protected volume.
  tmpdir = fs.mkdtempSync(path.join(path.dirname(source), '.gib-secure-verify-'));
  const snapshot = path.join(tmpdir, 'verification.sqlite');
  await decryptFile(source, snapshot, key);
  verifySqliteSnapshot(snapshot);
  console.log('Проверки аутентичности, SQLite и структуры пройдены. Это не заменяет испытания восстановления.');
} finally {
  key.fill(0);
  if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
}
