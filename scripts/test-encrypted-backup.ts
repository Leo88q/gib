import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { backupKeyFromEnvironment, encryptFile } from '../lib/encrypted-backup.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-encrypted-test-'));
const database = path.join(dir, 'live.sqlite');
process.env.GIB_STORE = 'sqlite'; process.env.GIB_SQLITE_FILE = database;
const { store } = await import('../lib/store.ts');
const key = '92'.repeat(32); const wrong = '31'.repeat(32);
const check = (v: unknown, label: string): void => { if (!v) throw new Error(label); console.log('  ok', label); };
const run = (script: string, args: string[], secret: string | undefined = key) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
  const env = { ...process.env, GIB_BACKUP_KEY_HEX: secret };
  const proc = spawn(process.execPath, ['--experimental-strip-types', script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; proc.stdout.on('data', d => { output += d; }); proc.stderr.on('data', d => { output += d; });
  proc.on('error', reject); proc.on('exit', code => resolve({ code, output }));
});
const backupScript = 'scripts/backup-sqlite-encrypted.ts';
const restoreScript = 'scripts/restore-sqlite-encrypted.ts';
try {
  for (const input of ['', 'zz'.repeat(32), 'ab'.repeat(31), 'test password']) {
    let rejected = false; try { backupKeyFromEnvironment(input); } catch { rejected = true; }
    check(rejected, 'некорректные ключи отклоняются');
  }
  store.transaction(() => {
    store.addProfile({ id: 'p-test', parentId: 'parent-test', name: 'НЕ ДЛЯ ОТКРЫТОГО ФАЙЛА', age: 8, band: '8-10', createdAt: 1 });
    const player = store.playerState('p-test'); player.coins = 42; store.setPlayerState(player);
  });
  const encrypted = path.join(dir, 'backup.gib'); const encrypted2 = path.join(dir, 'backup2.gib');
  const made = await run(backupScript, [database, encrypted]);
  check(made.code === 0 && !made.output.includes(key), 'зашифрованный снимок создан без вывода ключа');
  check((fs.statSync(encrypted).mode & 0o777) === 0o600, 'права файла 0600');
  check(!fs.readFileSync(encrypted).includes(Buffer.from('НЕ ДЛЯ ОТКРЫТОГО ФАЙЛА')), 'контрольный текст не содержится в открытом виде');
  check((await run(backupScript, [database, encrypted2])).code === 0 && !fs.readFileSync(encrypted).equals(fs.readFileSync(encrypted2)), 'разные случайные nonce создают разные шифротексты');
  store.transaction(() => { const player = store.playerState('p-test'); player.coins = 99; store.setPlayerState(player); });
  const verifyScript = 'scripts/verify-sqlite-encrypted.ts';
  const verify = await run(verifyScript, [encrypted]);
  check(verify.code === 0 && !verify.output.includes(key) && !verify.output.includes('НЕ ДЛЯ ОТКРЫТОГО ФАЙЛА'), 'отдельная проверка без публикации данных');
  check((await run(verifyScript, [encrypted], wrong)).code !== 0, 'проверка с неверным ключом отклонена');
  const restored = path.join(dir, 'restored.sqlite');
  const res = await run(restoreScript, [encrypted, restored]);
  check(res.code === 0 && !res.output.includes(key), 'восстановление прошло без вывода ключа');
  check((fs.statSync(restored).mode & 0o777) === 0o600, 'восстановленная база доступна владельцу');
  const read = new DatabaseSync(restored, { readOnly: true });
  const snapshot = JSON.parse(String(read.prepare('SELECT data FROM app_state WHERE id=1').get()?.data)); read.close();
  check(snapshot.profiles[0].name === 'НЕ ДЛЯ ОТКРЫТОГО ФАЙЛА' && snapshot.playerStates[0].coins === 42, 'восстановлена согласованная версия до изменения источника');
  check(store.playerState('p-test').coins === 99, 'источник после восстановления не изменён');
  check((await run('scripts/test-encrypted-restore-store-child.ts', [restored])).code === 0 && store.playerState('p-test').coins === 99, 'восстановленная база запускается и записывается через адаптер отдельно от источника');
  const overwrite = await run(restoreScript, [encrypted, restored]);
  check(overwrite.code !== 0 && fs.existsSync(restored), 'существующий файл не перезаписывается');
  check((await run(backupScript, [database, encrypted])).code !== 0, 'существующий зашифрованный снимок не перезаписывается');
  const wrongTarget = path.join(dir, 'wrong.sqlite');
  check((await run(restoreScript, [encrypted, wrongTarget], wrong)).code !== 0 && !fs.existsSync(wrongTarget), 'неверный ключ не публикует базу');
  const bytes = fs.readFileSync(encrypted);
  for (const [name, pos] of [['magic', 0], ['nonce', 10], ['payload', 25], ['tag', bytes.length - 1]] as const) {
    const altered = Buffer.from(bytes); altered[pos] ^= 1;
    const bad = path.join(dir, `${name}.gib`); const target = path.join(dir, `${name}.sqlite`); fs.writeFileSync(bad, altered);
    check((await run(restoreScript, [bad, target])).code !== 0 && !fs.existsSync(target), `подмена ${name} отклонена без публикации`);
  }
  const cut = path.join(dir, 'truncated.gib'); fs.writeFileSync(cut, bytes.subarray(0, bytes.length - 7));
  check((await run(restoreScript, [cut, path.join(dir, 'truncated.sqlite')])).code !== 0 && !fs.existsSync(path.join(dir, 'truncated.sqlite')), 'обрезанный снимок отклонён');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const target = path.join(dir, `sidecar${suffix.slice(1)}.sqlite`); fs.writeFileSync(target + suffix, 'stale');
    check((await run(restoreScript, [encrypted, target])).code !== 0 && !fs.existsSync(target), `существующий ${suffix} блокирует восстановление`);
  }
  const invalid = path.join(dir, 'invalid.sqlite');
  const badDb = new DatabaseSync(invalid); badDb.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  badDb.prepare('INSERT INTO app_state VALUES (1, ?)').run(JSON.stringify({ profiles: [null], sessions: [] })); badDb.close();
  const invalidTarget = path.join(dir, 'invalid.gib');
  check((await run(backupScript, [invalid, invalidTarget])).code !== 0 && !fs.existsSync(invalidTarget), 'невалидная исходная база не публикуется');
  const unsafe = path.join(dir, 'bad-authentic.gib'); const keyBuffer = Buffer.from(key, 'hex');
  await encryptFile(invalid, unsafe, keyBuffer); keyBuffer.fill(0);
  const invalidRestore = path.join(dir, 'bad-authentic.sqlite');
  check((await run(restoreScript, [unsafe, invalidRestore])).code !== 0 && !fs.existsSync(invalidRestore), 'аутентичная, но некорректная база не публикуется');
  check((await run(backupScript, [database, path.join(dir, 'nokey.gib')], '')).code !== 0 && !fs.existsSync(path.join(dir, 'nokey.gib')), 'без ключа снимок не создаётся');
  check((await run(verifyScript, [unsafe])).code !== 0, 'проверка отклоняет аутентичную невалидную базу');
  check(!fs.readdirSync(dir).some(name => name.startsWith('.gib-secure-')), 'временные каталоги удалены при обычных отказах');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
