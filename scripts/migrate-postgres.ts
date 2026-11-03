/** One-time, offline, experimental transfer. Does not switch the running application. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import pg from 'pg';
import { ensureSchema, importLegacy, prepareImport, type SqlClient } from '../lib/postgres/migrate.ts';
import { verifySqliteSnapshot } from '../lib/sqlite-snapshot.ts';

const [kind, sourceArg, ...extra] = process.argv.slice(2);
if ((kind !== '--json' && kind !== '--sqlite') || !sourceArg || extra.length || process.env.GIB_POSTGRES_OFFLINE_IMPORT !== '1') {
  console.error('Использование: GIB_POSTGRES_OFFLINE_IMPORT=1 npm run migrate:postgres -- --json|--sqlite <источник>. Остановите все процессы записи; URL и секреты передаются только через окружение.');
  process.exitCode = 1;
} else {
  let tmpdir: string | undefined;
  let pool: pg.Pool | undefined;
  let client: pg.PoolClient | undefined;
  try {
    const connectionString = process.env.GIB_POSTGRES_URL;
    if (!connectionString) throw new Error('Database configuration required');
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 ||
        [...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) throw new Error('Invalid database configuration');
    // Explicit verified TLS by default. The opt-out is solely for isolated local test databases.
    const insecure = process.env.GIB_POSTGRES_INSECURE_TEST === '1';
    const effectiveHost = url.searchParams.get('host') || url.hostname;
    if (insecure && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(effectiveHost) && !effectiveHost.startsWith('/')) throw new Error('Insecure mode restricted to local test connections');
    const ca = process.env.GIB_POSTGRES_CA_FILE ? fs.readFileSync(process.env.GIB_POSTGRES_CA_FILE, 'utf8') : undefined;
    const ssl = insecure ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
    const source = path.resolve(sourceArg);
    if (!fs.statSync(source).isFile()) throw new Error('Invalid source');
    let original: unknown;
    if (kind === '--json') {
      original = JSON.parse(fs.readFileSync(source, 'utf8'));
    } else {
      // Protected scratch folder next to source; still a plaintext SQLite snapshot.
      tmpdir = fs.mkdtempSync(path.join(path.dirname(source), '.gib-postgres-import-'));
      const snapshot = path.join(tmpdir, 'snapshot.sqlite');
      const sourceDb = new DatabaseSync(source, { readOnly: true });
      try { await backup(sourceDb, snapshot); } finally { sourceDb.close(); }
      fs.chmodSync(snapshot, 0o600); verifySqliteSnapshot(snapshot);
      const copied = new DatabaseSync(snapshot, { readOnly: true });
      try { original = JSON.parse(String(copied.prepare('SELECT data FROM app_state WHERE id=1').get()?.data)); }
      finally { copied.close(); }
    }
    prepareImport(original); // reject invalid input before touching destination
    pool = new pg.Pool({ connectionString, ssl, max: 1, connectionTimeoutMillis: 10_000 });
    client = await pool.connect();
    const adapter: SqlClient = { query: async (sql, params) => client!.query(sql, params) };
    await ensureSchema(adapter);
    const counts = await importLegacy(adapter, original);
    console.log('Импорт проверен и зафиксирован; исходный файл не изменён. Количество записей:', counts);
    console.log('Приложение по-прежнему использует прежнее хранилище; production API заблокирован.');
  } catch {
    // Never print connection strings, credentials, SQL values or child data.
    console.error('Импорт PostgreSQL не подтверждён. Проверьте источник, TLS, разрешения и состояние назначения; при потере связи во время фиксации результат может быть неизвестен. Не повторяйте без проверки.');
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool?.end();
    if (tmpdir) fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}
