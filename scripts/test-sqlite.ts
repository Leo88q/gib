import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-sqlite-test-'));
const file = path.join(dir, 'test.sqlite');
process.env.GIB_STORE = 'sqlite'; process.env.GIB_SQLITE_FILE = file;
const { store } = await import('../lib/store.ts');
function check(value: unknown, name: string): asserts value { if (!value) throw new Error(name); console.log('  ok', name); }
const child = (script: string, args: string[] = []) => new Promise<void>((resolve, reject) => {
  const env = { ...process.env };
  if (script.endsWith('test-invalid-store-child.ts')) env.GIB_SQLITE_FILE = args[0];
  const proc = spawn(process.execPath, ['--experimental-strip-types', script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; proc.stderr.on('data', d => { output += d; });
  proc.on('error', reject); proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exit ${code}: ${output}`)));
});
try {
  store.transaction(() => { const player = store.playerState('sqlite-concurrency-test'); player.coins = 0; store.setPlayerState(player); });
  let rolledBack = false;
  try { store.transaction(() => { const player = store.playerState('sqlite-concurrency-test'); player.coins = 999; store.setPlayerState(player); throw new Error('rollback'); }); } catch { rolledBack = true; }
  check(rolledBack && store.playerState('sqlite-concurrency-test').coins === 0, 'ошибка откатывает все изменения');
  await Promise.all(Array.from({ length: 4 }, () => child('scripts/sqlite-worker.ts')));
  check(store.playerState('sqlite-concurrency-test').coins === 200, 'четыре процесса не теряют обновления');
  const snapshotFile = path.join(dir, 'snapshot.sqlite');
  await child('scripts/backup-sqlite.ts', [file, snapshotFile]);
  store.transaction(() => { const player = store.playerState('sqlite-concurrency-test'); player.coins = 201; store.setPlayerState(player); });
  const { DatabaseSync } = await import('node:sqlite');
  const restored = new DatabaseSync(snapshotFile, { readOnly: true });
  const snapshot = JSON.parse(String(restored.prepare('SELECT data FROM app_state WHERE id=1').get()?.data));
  restored.close();
  check(snapshot.playerStates.find((p: { profileId: string }) => p.profileId === 'sqlite-concurrency-test').coins === 200, 'снимок WAL восстанавливает состояние на момент создания');
  check((fs.statSync(snapshotFile).mode & 0o777) === 0o600, 'снимок доступен только владельцу');
  const restoredFile = path.join(dir, 'restored.sqlite');
  fs.copyFileSync(snapshotFile, restoredFile, fs.constants.COPYFILE_EXCL);
  await child('scripts/sqlite-restore-check.ts', [restoredFile]);
  check(true, 'копия запускается и принимает изменения через адаптер в отдельном процессе');
  let overwritePrevented = false;
  try { await child('scripts/backup-sqlite.ts', [file, snapshotFile]); } catch { overwritePrevented = true; }
  check(overwritePrevented, 'существующая резервная копия не перезаписывается');
  const invalid = path.join(dir, 'invalid.sqlite');
  const invalidDb = new DatabaseSync(invalid);
  invalidDb.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  const damaged = JSON.stringify({ profiles: [], sessions: [], payments: 'invalid' });
  invalidDb.prepare('INSERT INTO app_state VALUES (1, ?)').run(damaged);
  invalidDb.close();
  await child('scripts/test-invalid-store-child.ts', [invalid]);
  const invalidRead = new DatabaseSync(invalid, { readOnly: true });
  check(invalidRead.prepare('SELECT data FROM app_state WHERE id=1').get()?.data === damaged, 'повреждённое SQLite-состояние отклоняется без перезаписи');
  invalidRead.close();
  let backupRejected = false;
  try { await child('scripts/backup-sqlite.ts', [invalid, path.join(dir, 'invalid-copy.sqlite')]); } catch { backupRejected = true; }
  check(backupRejected && !fs.existsSync(path.join(dir, 'invalid-copy.sqlite')), 'неисправный снимок не публикуется');
  const invalidJson = path.join(dir, 'invalid.json');
  const badJson = JSON.stringify({ profiles: [], sessions: [], skills: {} });
  fs.writeFileSync(invalidJson, badJson);
  const jsonProcess = spawn(process.execPath, ['--experimental-strip-types', 'scripts/test-invalid-store-child.ts'], {
    env: { ...process.env, GIB_STORE: 'json', GIB_DATA_FILE: invalidJson }, stdio: 'ignore'
  });
  const jsonExit = await new Promise<number | null>((resolve, reject) => { jsonProcess.on('error', reject); jsonProcess.on('exit', resolve); });
  check(jsonExit === 0 && fs.readFileSync(invalidJson, 'utf8') === badJson, 'повреждённый JSON отклоняется без перезаписи');
  // Nested corruption must be rejected consistently by reads, backups and imports.
  const nestedCases = [
    { profiles: [null], sessions: [] },
    { profiles: [{ id: 'p', parentId: 'a' }, { id: 'p', parentId: 'b' }], sessions: [] },
    { profiles: [], sessions: [{ id: 's', profileId: 'p', tasks: [], runtime: { sessionId: 's', profileId: 'p', items: [], plan: [], index: 3 } }] },
    { profiles: [], sessions: [], playerStates: [{ profileId: 'p', missions: { ids: {}, progress: {} } }] },
    { profiles: [], sessions: [], payments: [{ id: 'pay', profileId: 'p', status: 'mystery' }] },
  ];
  for (let i = 0; i < nestedCases.length; i++) {
    const data = JSON.stringify(nestedCases[i]);
    const broken = path.join(dir, `nested-${i}.sqlite`);
    const b = new DatabaseSync(broken); b.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    b.prepare('INSERT INTO app_state VALUES (1, ?)').run(data); b.close();
    await child('scripts/test-invalid-store-child.ts', [broken]);
    const unchanged = new DatabaseSync(broken, { readOnly: true });
    check(unchanged.prepare('SELECT data FROM app_state WHERE id=1').get()?.data === data, 'вложенное повреждение отклонено без изменения SQLite'); unchanged.close();
    let refusedBackup = false;
    try { await child('scripts/backup-sqlite.ts', [broken, path.join(dir, `nested-copy-${i}.sqlite`)]); } catch { refusedBackup = true; }
    check(refusedBackup && !fs.existsSync(path.join(dir, `nested-copy-${i}.sqlite`)), 'повреждённый снимок не опубликован');
    const sourceBroken = path.join(dir, `nested-${i}.json`); const targetBroken = path.join(dir, `nested-import-${i}.sqlite`);
    fs.writeFileSync(sourceBroken, data);
    let refusedImport = false;
    try { await child('scripts/migrate-json-sqlite.ts', [sourceBroken, targetBroken]); } catch { refusedImport = true; }
    check(refusedImport && !fs.existsSync(targetBroken) && fs.readFileSync(sourceBroken, 'utf8') === data, 'импорт отклонён до создания базы, исходник не изменён');
  }
  const missing = path.join(dir, 'missing-row.sqlite');
  const m = new DatabaseSync(missing); m.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)'); m.close();
  await child('scripts/test-invalid-store-child.ts', [missing]);
  const missingRead = new DatabaseSync(missing, { readOnly: true });
  check(missingRead.prepare('SELECT count(*) AS n FROM app_state').get()?.n === 0, 'отсутствующая запись не заменяется пустыми данными'); missingRead.close();
  const beforeBadCommit = store.playerState('sqlite-concurrency-test').coins;
  let refusedCommit = false;
  try { store.transaction(() => { (store.all().playerStates[0] as any).missions = []; }); } catch { refusedCommit = true; }
  check(refusedCommit && store.playerState('sqlite-concurrency-test').coins === beforeBadCommit && !Array.isArray(store.playerState('sqlite-concurrency-test').missions), 'повреждённая транзакция откатывается');
  const absentRequired = path.join(dir, 'does-not-exist.sqlite');
  await child('scripts/test-store-must-exist-child.ts', [absentRequired, 'invalid']);
  check(!fs.existsSync(absentRequired), 'режим существующей базы не создаёт файл при ошибке пути');
  const blankRequired = path.join(dir, 'blank-required.sqlite'); fs.writeFileSync(blankRequired, '');
  await child('scripts/test-store-must-exist-child.ts', [blankRequired, 'invalid']);
  const blankDb = new DatabaseSync(blankRequired, { readOnly: true });
  check(blankDb.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='app_state'").get()?.n === 0, 'пустая существующая база не заменяется новым состоянием'); blankDb.close();
  await child('scripts/test-store-must-exist-child.ts', [file, 'valid']);
  check(true, 'режим существующей базы открывает подготовленное состояние');
  // `postgres` теперь полноценный режим, поэтому проверяем только опечатки.
  // Молчаливый откат на JSON запрещён для любого неизвестного значения.
  for (const mode of ['sqltie', 'pg', 'postgre']) {
    const unintendedFile = path.join(dir, `unexpected-${mode}.json`);
    const processForMode = spawn(process.execPath, ['--experimental-strip-types', 'scripts/test-store-mode-child.ts'], {
      env: { ...process.env, GIB_STORE: mode, GIB_DATA_FILE: unintendedFile }, stdio: 'ignore'
    });
    const code = await new Promise<number | null>((resolve, reject) => { processForMode.on('error', reject); processForMode.on('exit', resolve); });
    check(code === 0 && !fs.existsSync(unintendedFile), 'неподдерживаемый режим не переключается молча на JSON');
  }
  const jsonWriteFile = path.join(dir, 'json-write.json');
  const jsonWrite = spawn(process.execPath, ['--experimental-strip-types', 'scripts/test-json-integrity-child.ts'], {
    env: { ...process.env, GIB_STORE: 'json', GIB_DATA_FILE: jsonWriteFile }, stdio: 'ignore'
  });
  const jsonWriteExit = await new Promise<number | null>((resolve, reject) => { jsonWrite.on('error', reject); jsonWrite.on('exit', resolve); });
  check(jsonWriteExit === 0, 'ошибка записи JSON и транзакции не повреждает файл или кэш');
  const source = path.join(dir, 'source.json'); const target = path.join(dir, 'import.sqlite');
  const original = JSON.stringify({ profiles: [{ id:'p1', parentId:'demo:p', name:'Тест', age:8, band:'8-10', createdAt:1 }], sessions: [], skills: [] });
  fs.writeFileSync(source, original);
  await child('scripts/migrate-json-sqlite.ts', [source, target]);
  check(fs.readFileSync(source, 'utf8') === original, 'импорт не меняет исходный JSON');
  const migrated = new DatabaseSync(target, { readOnly: true });
  const data = JSON.parse(String(migrated.prepare('SELECT data FROM app_state WHERE id=1').get()?.data));
  migrated.close();
  check(data.profiles[0].id === 'p1' && Array.isArray(data.payments), 'профиль и поля миграции записаны');
  let prevented = false;
  try { await child('scripts/migrate-json-sqlite.ts', [source, target]); } catch { prevented = true; }
  check(prevented, 'импорт в непустую базу запрещён');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
