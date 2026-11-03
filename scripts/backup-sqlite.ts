/** Consistent local snapshot, including committed WAL pages. Never overwrite a backup. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error('Usage: npm run backup:sqlite -- <source.sqlite> <new-backup.sqlite>');
const source = path.resolve(sourceArg);
const target = path.resolve(targetArg);
if (source === target || !fs.statSync(source).isFile()) throw new Error('Invalid source or destination');
const parent = path.dirname(target);
// The temporary directory is private even when target's parent is shared.
const tmpdir = fs.mkdtempSync(path.join(parent, '.gib-backup-'));
const tmp = path.join(tmpdir, 'snapshot.sqlite');
let sourceDb: DatabaseSync | undefined;
try {
  sourceDb = new DatabaseSync(source, { readOnly: true });
  await backup(sourceDb, tmp);
  fs.chmodSync(tmp, 0o600);
  verifySqliteSnapshot(tmp);
  // Link is atomic and fails if target exists, unlike rename on POSIX.
  fs.linkSync(tmp, target);
  console.log('Снимок проверен и сохранён. Проверьте восстановление; храните его в защищённом месте.');
} finally {
  sourceDb?.close();
  fs.rmSync(tmpdir, { recursive: true, force: true });
}
