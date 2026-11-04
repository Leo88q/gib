/**
 * Учебная авария: снимок → шифрование → восстановление → проверка → приёмка.
 *
 * Проходит весь путь на одноразовой базе в отдельном процессе, как это
 * делал бы администратор. Проверяется не только «файл появился», но и что
 * данные после восстановления те же и что копия с неверным ключом не проходит.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gib-drill-'));
const live = path.join(dir, 'live.sqlite');
process.env.GIB_STORE = 'sqlite';
process.env.GIB_SQLITE_FILE = live;

const key = '5a'.repeat(32);
const wrongKey = 'c3'.repeat(32);

function run(script: string, args: string[], secret = key): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    // Скрипты резервирования запускаются так же, как из npm: через strip-types,
    // а проверка копии — через tsx, потому что она импортирует модуль приложения.
    const launcher = script.includes('restore-check') ? [require.resolve('tsx/cli')] : ['--experimental-strip-types'];
    const proc = spawn(process.execPath, [...launcher, script, ...args], {
      env: { ...process.env, GIB_BACKUP_KEY_HEX: secret },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout.on('data', d => { output += String(d); });
    proc.stderr.on('data', d => { output += String(d); });
    proc.on('error', reject);
    proc.on('exit', code => resolve({ code, output }));
  });
}

async function main() {
  const { store } = await import('../lib/store');
  // Профиль и награда: после восстановления значения должны совпасть.
  store.addProfile({ id: 'p_drill', parentId: 'demo:drill', name: 'Мира', age: 9, band: '8-10', createdAt: Date.now() } as any);
  store.transaction(() => {
    const player = store.playerState('p_drill');
    player.coins = 42;
    store.setPlayerState(player);
  });
  assert.equal(store.playerState('p_drill').coins, 42);

  // 1. Снимок живой базы.
  const snapshot = path.join(dir, 'snapshot.sqlite');
  const backup = await run('scripts/backup-sqlite.ts', [live, snapshot], key);
  assert.equal(backup.code, 0, `снимок снят: ${backup.output.slice(-200)}`);
  assert.ok(fs.statSync(snapshot).size > 0, 'снимок не пустой');
  console.log('  ok снимок живой базы снят');

  // 2. Шифрование: копия не читается как база.
  const encrypted = path.join(dir, 'backup.gib');
  const enc = await run('scripts/backup-sqlite-encrypted.ts', [live, encrypted], key);
  assert.equal(enc.code, 0, `копия зашифрована: ${enc.output.slice(-200)}`);
  const head = fs.readFileSync(encrypted).subarray(0, 8).toString('ascii');
  assert.equal(head, 'GIBBAK01', 'формат копии опознаваем');
  assert.ok(!fs.readFileSync(encrypted).includes(Buffer.from('p_drill')), 'в зашифрованной копии нет открытых данных');
  console.log('  ok копия зашифрована и данных в открытом виде нет');

  // 3. Неверный ключ — восстановление не проходит.
  const wrongTarget = path.join(dir, 'wrong.sqlite');
  const wrong = await run('scripts/restore-sqlite-encrypted.ts', [encrypted, wrongTarget], wrongKey);
  assert.notEqual(wrong.code, 0, 'с неверным ключом восстановление отклонено');
  assert.equal(fs.existsSync(wrongTarget), false, 'файл с неверным ключом не создан');
  console.log('  ok неверный ключ не даёт восстановить копию');

  // 4. Верный ключ — возврат в новый файл.
  const restored = path.join(dir, 'restored.sqlite');
  const rest = await run('scripts/restore-sqlite-encrypted.ts', [encrypted, restored], key);
  assert.equal(rest.code, 0, `копия восстановлена: ${rest.output.slice(-200)}`);
  assert.ok(fs.existsSync(restored), 'восстановленный файл создан');
  console.log('  ok копия восстановлена в новый файл');

  // 5. Приёмка: проверка копии и совпадение данных.
  const check = await run('scripts/restore-check.ts', [restored], key);
  assert.equal(check.code, 0, `проверка пройдена: ${check.output.slice(-300)}`);
  assert.ok(check.output.includes('Итог: копию можно подключать'), 'итог проверки положительный');

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(restored, { readOnly: true });
  try {
    const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get() as { data: string };
    const state = JSON.parse(row.data);
    assert.ok(state.profiles.some((p: { id: string }) => p.id === 'p_drill'), 'профиль на месте');
    const player = state.playerStates.find((p: { profileId: string }) => p.profileId === 'p_drill');
    assert.equal(player.coins, 42, 'награда та же');
    assert.ok(Array.isArray(state.parentPins), 'состояние аккаунта тоже сохранено');
  } finally { db.close(); }
  console.log('  ok приёмка: профиль и награды совпадают с исходными');

  // 6. Повторная запись в восстановленную базу разрешена: она не «только для чтения».
  process.env.GIB_SQLITE_FILE = restored;
  // Кэш хранилища уже держит живую базу: проверяем запись отдельным процессом.
  const write = await new Promise<number | null>((resolve) => {
    const code = 'process.env.GIB_STORE="sqlite";process.env.GIB_SQLITE_FILE=process.argv[1];' +
      'const {store}=await import("./lib/store.ts");store.transaction(()=>{const p=store.playerState("p_drill");p.coins++;store.setPlayerState(p);});' +
      'if(store.playerState("p_drill").coins!==43)process.exit(1);';
    const proc = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code, restored], { stdio: 'inherit' });
    proc.on('exit', resolve);
  });
  assert.equal(write, 0, 'восстановленная база доступна на запись');
  console.log('  ok восстановленная база доступна на запись');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ok аварийное восстановление: снимок, шифрование, отказ по ключу, приёмка, запись');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
