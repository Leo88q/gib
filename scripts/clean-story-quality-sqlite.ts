/** Preview or publish a sanitised SQLite COPY, never edit the original database. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync, backup } from 'node:sqlite';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';
import { cleanStoryQuality } from '../lib/story-quality-cleanup.ts';

async function main() {
  const [mode, sourceArg, outputArg, ...extra] = process.argv.slice(2);
  if (extra.length || !sourceArg || !['--dry-run', '--copy'].includes(mode) || (mode === '--copy' ? !outputArg : outputArg !== undefined)) {
    throw new Error('Usage: --dry-run <source.sqlite> | --copy <source.sqlite> <new-copy.sqlite>');
  }
  const source=path.resolve(sourceArg), target=outputArg ? path.resolve(outputArg) : undefined;
  if (!fs.statSync(source).isFile() || target === source) throw new Error('Invalid source or destination');
  // Even the preview uses the backup API: it observes a consistent WAL state.
  // The private directory must be on the destination filesystem for atomic publication.
  const parent=target ? path.dirname(target) : os.tmpdir();
  const dir=fs.mkdtempSync(path.join(parent,'.gib-cleanup-'));
  const tmp=path.join(dir,'snapshot.sqlite');
  let src:DatabaseSync | undefined; let copy:DatabaseSync | undefined;
  try {
    src=new DatabaseSync(source,{readOnly:true});
    await backup(src,tmp); src.close(); src=undefined;
    fs.chmodSync(tmp,0o600);
    verifySqliteSnapshot(tmp);
    copy=new DatabaseSync(tmp);
    const data=copy.prepare('SELECT data FROM app_state WHERE id=1').get()?.data;
    if(typeof data!=='string') throw new Error('State missing');
    const {state,counts}=cleanStoryQuality(JSON.parse(data));
    if (target) {
      copy.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
      try {
        const written=copy.prepare('UPDATE app_state SET data=? WHERE id=1').run(JSON.stringify(state));
        if(Number(written.changes)!==1) throw new Error('State missing');
        copy.exec('COMMIT');
      } catch (e) { copy.exec('ROLLBACK'); throw e; }
      // Rebuild the private copy to avoid retaining old SQLite pages in that file.
      // This cannot securely erase old storage blocks, the source, WALs, or backups.
      copy.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM');
      copy.close(); copy=undefined;
      verifySqliteSnapshot(tmp);
      const fd=fs.openSync(tmp,'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      fs.linkSync(tmp,target); // atomic and no overwrite, even for symlinks
    }
    console.log(JSON.stringify({mode:target?'copy':'dry-run',...counts},null,2));
    console.log('Исходник, активные сессии, квитанции, другие хранилища и резервные копии не изменяются. Копия отражает только момент снимка; перед восстановлением остановите запись и проверьте backup/restore.');
  } finally {
    copy?.close(); src?.close(); fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{ console.error(error instanceof Error ? error.message : 'Cleanup failed'); process.exitCode=1; });
