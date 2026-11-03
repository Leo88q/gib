import { DatabaseSync } from 'node:sqlite';
import { validateStore } from './store-validation.ts';

/** Checks SQLite pages and the subset of application state we know how to validate. */
export function verifySqliteSnapshot(file: string): void {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('SQLite integrity check failed');
    const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get();
    if (typeof row?.data !== 'string') throw new Error('State missing');
    validateStore(JSON.parse(row.data));
  } finally { db.close(); }
}
