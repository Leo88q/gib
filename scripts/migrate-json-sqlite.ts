/** One-time import into an empty SQLite database. Source remains unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import { STORE_COLLECTIONS, validateStore } from '../lib/store-validation.ts';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node --experimental-strip-types scripts/migrate-json-sqlite.ts <source.json> <destination.sqlite>');
if (path.resolve(source) === path.resolve(destination)) throw new Error('Source and destination must differ');
const original: unknown = JSON.parse(fs.readFileSync(source, 'utf8'));
validateStore(original);
const input = original as Record<string, unknown>;
const collections = STORE_COLLECTIONS;
process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = path.resolve(destination);
const { store } = await import('../lib/store.ts');
store.transaction(() => {
  const destinationDb = store.all();
  if (collections.some(k => destinationDb[k].length > 0)) throw new Error('Destination database is not empty');
  for (const key of collections) (destinationDb as unknown as Record<string, unknown>)[key] = input[key] ?? [];
});
console.log('Импорт выполнен. Исходный JSON не изменён. Проверьте восстановление и сделайте резервную копию.');
