import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Payment, PlayerState, Profile, ProgramState, Session, SkillState, Subscription } from './types.ts';
import { emptyStats, todayKey } from './gamification.ts';
import { validateStore } from './store-validation.ts';

type DB = {
  profiles: Profile[];
  skills: (SkillState & { profileId: string })[];
  sessions: Session[];
  subs: Subscription[];
  programStates: ProgramState[];
  playerStates: PlayerState[];
  payments: Payment[];
};

const FILE = process.env.GIB_DATA_FILE || path.join(process.cwd(), 'data', 'db.json');

let cache: DB | null = null;
let transactionDepth = 0;
const storeMode = process.env.GIB_STORE || 'json';
// Fail closed: PostgreSQL session work is experimental and is not the app store yet.
if (storeMode !== 'json' && storeMode !== 'sqlite') throw new Error('Unsupported GIB_STORE mode');
const sqliteEnabled = storeMode === 'sqlite';
const sqliteFile = process.env.GIB_SQLITE_FILE || path.join(process.cwd(), 'data', 'gib.sqlite');
const sqliteMustExist = process.env.GIB_SQLITE_MUST_EXIST === '1';
let database: DatabaseSync | null = null;

function sqlite(): DatabaseSync {
  if (database) return database;
  if (sqliteMustExist) {
    try { if (!fs.statSync(sqliteFile).isFile()) throw new Error('not a file'); }
    catch { throw new Error('Required SQLite database is missing or inaccessible'); }
  } else fs.mkdirSync(path.dirname(sqliteFile), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(sqliteFile);
  try {
    fs.chmodSync(sqliteFile, 0o600);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (!tables.length) {
        if (sqliteMustExist) throw new Error('Required SQLite state is missing');
        db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
        db.prepare('INSERT INTO app_state (id, data) VALUES (1, ?)').run(JSON.stringify(empty()));
      } else if (!tables.some(table => table.name === 'app_state') || !db.prepare('SELECT 1 FROM app_state WHERE id = 1').get()) {
        throw new Error('SQLite state missing');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    database = db;
    return db;
  } catch (error) { db.close(); throw error; }
}


function empty(): DB {
  return {
    profiles: [],
    skills: [],
    sessions: [],
    subs: [],
    programStates: [],
    playerStates: [],
    payments: [],
  };
}

/** Never convert damaged state into an empty database. Missing newer collections are migrated in memory. */
function parseState(value: unknown): DB {
  validateStore(value);
  const input = value as Record<string, unknown>;
  const defaults = empty();
  for (const key of Object.keys(defaults) as (keyof DB)[]) {
    if (input[key] !== undefined && !Array.isArray(input[key])) throw new Error(`Invalid store collection: ${key}`);
  }
  return { ...defaults, ...Object.fromEntries((Object.keys(defaults) as (keyof DB)[]).map(key => [key, input[key] ?? defaults[key]])) } as DB;
}

function load(): DB {
  if (cache) return cache;
  if (sqliteEnabled) {
    const row = sqlite().prepare('SELECT data FROM app_state WHERE id = 1').get() as { data: string } | undefined;
    if (!row) throw new Error('SQLite state missing');
    cache = parseState(JSON.parse(row.data));
    return cache;
  }
  try {
    cache = parseState(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    cache = empty();
  }
  return cache;
}

function persist() {
  if (transactionDepth > 0) return;
  if (sqliteEnabled) throw new Error('SQLite writes require a transaction');
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const temp = `${FILE}.${process.pid}.tmp`;
  try {
    validateStore(cache);
    fs.writeFileSync(temp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    fs.renameSync(temp, FILE);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* временный файл мог не создаться */ }
    cache = null; // discard mutations when a non-transactional JSON write fails
    throw error;
  }
}

const implementation = {
  /** SQLite uses a write lock and a single atomic commit; JSON is local demo only. */
  transaction<T>(fn: () => T): T {
    if (transactionDepth > 0) return fn();
    if (sqliteEnabled) {
      const db = sqlite();
      db.exec('BEGIN IMMEDIATE');
      cache = null;
      transactionDepth = 1;
      try {
        const result = fn();
        if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('Async transaction is not supported');
        validateStore(load());
        const write = db.prepare('UPDATE app_state SET data = ? WHERE id = 1').run(JSON.stringify(load()));
        if (Number(write.changes) !== 1) throw new Error('SQLite state missing');
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally { transactionDepth = 0; cache = null; }
    }
    const before = structuredClone(load());
    transactionDepth = 1;
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('Async transaction is not supported');
      transactionDepth = 0;
      persist();
      return result;
    } catch (error) { transactionDepth = 0; cache = before; throw error; }
  },
  all() {
    return load();
  },
  save() {
    persist();
  },
  profiles: () => load().profiles,
  profile: (id: string) => load().profiles.find((p) => p.id === id),
  profileByParent: (parentId: string) => load().profiles.find((p) => p.parentId === parentId),
  addProfile(p: Profile) {
    load().profiles.push(p);
    persist();
  },
  deleteProfile(profileId: string) {
    return this.transaction(() => {
      const db = load();
      db.profiles = db.profiles.filter(p => p.id !== profileId);
      db.skills = db.skills.filter(s => (s as SkillState & { profileId: string }).profileId !== profileId);
      db.sessions = db.sessions.filter(s => s.profileId !== profileId);
      db.subs = db.subs.filter(s => s.profileId !== profileId);
      db.payments = db.payments.filter(p => p.profileId !== profileId);
      db.programStates = db.programStates.filter(s => s.profileId !== profileId);
      db.playerStates = db.playerStates.filter(s => s.profileId !== profileId);
    });
  },
  skills: (profileId: string) =>
    (load().skills as (SkillState & { profileId: string })[]).filter((s) => s.profileId === profileId),
  addSkill(s: SkillState & { profileId: string }) {
    load().skills.push(s);
    persist();
  },
  updateSkill(profileId: string, skill: string, patch: Partial<SkillState>) {
    const arr = load().skills as (SkillState & { profileId: string })[];
    const item = arr.find((s) => s.profileId === profileId && s.skill === skill);
    if (item) {
      Object.assign(item, patch);
      persist();
    }
    return item;
  },
  sessions: (profileId: string) => load().sessions.filter((s) => s.profileId === profileId),
  addSession(s: Session) {
    load().sessions.push(s);
    persist();
  },
  getSession: (id: string) => load().sessions.find((s) => s.id === id),
  updateSession(id: string, patch: Partial<Session>) {
    const s = load().sessions.find((x) => x.id === id);
    if (s) {
      Object.assign(s, patch);
      persist();
    }
    return s;
  },
  programState: (profileId: string) => {
    const arr = load().programStates as ProgramState[];
    const found = arr.find((s) => s.profileId === profileId);
    if (found) return found;
    const fresh: ProgramState = {
      profileId,
      completedDays: 0,
      lastDayIndex: 0,
      startedAt: Date.now(),
    };
    arr.push(fresh);
    persist();
    return fresh;
  },
  setProgramState(state: ProgramState) {
    const arr = load().programStates as ProgramState[];
    const i = arr.findIndex((s) => s.profileId === state.profileId);
    if (i >= 0) arr[i] = state;
    else arr.push(state);
    persist();
  },
  playerState: (profileId: string) => {
    const arr = load().playerStates as PlayerState[];
    const found = arr.find((p) => p.profileId === profileId);
    if (found) {
      // страховка от частично записанных записей
      found.stats = { ...emptyStats(), ...(found.stats ?? {}) };
      found.equipped = { head: null, body: null, pet: null, room: null, ...(found.equipped as Partial<typeof found.equipped>) };
      found.missions = { day: 0, ids: [], progress: {}, claimed: [], ...(found.missions as Partial<typeof found.missions>) };
      found.badges = found.badges ?? [];
      found.inventory = found.inventory ?? [];
      return found;
    }
    const fresh: PlayerState = {
      profileId,
      xp: 0,
      coins: 0,
      stars: 0,
      streak: 0,
      bestStreak: 0,
      lastActiveDay: '',
      badges: [],
      inventory: [],
      equipped: { head: null, body: null, pet: null, room: null },
      missions: { day: 0, ids: [], progress: {}, claimed: [] },
      stats: emptyStats(),
      startedAt: Date.now(),
    };
    arr.push(fresh);
    persist();
    return fresh;
  },
  setPlayerState(state: PlayerState) {
    const arr = load().playerStates;
    const i = arr.findIndex((p) => p.profileId === state.profileId);
    if (i >= 0) arr[i] = state;
    else arr.push(state);
    persist();
  },
  payments: (profileId: string) => load().payments.filter(p => p.profileId === profileId),
  paymentByProviderId: (id: string) => load().payments.find(p => p.providerId === id),
  savePayment(payment: Payment) {
    const payments = load().payments;
    const index = payments.findIndex(p => p.id === payment.id);
    if (index < 0) payments.push(payment); else payments[index] = payment;
    persist();
  },
  subs: () => load().subs,
  sub: (profileId: string) => load().subs.find((s) => s.profileId === profileId),
  setSub(sub: Subscription) {
    const arr = load().subs;
    const i = arr.findIndex((s) => s.profileId === sub.profileId);
    if (i >= 0) arr[i] = sub;
    else arr.push(sub);
    persist();
  },
};

/** SQLite: автоматически объединяем отдельные методы в транзакции. Для связанных
 * операций вызывающий код обязан использовать общую store.transaction. */
export const store: typeof implementation = sqliteEnabled ? new Proxy(implementation, {
  get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    if (typeof value !== 'function' || key === 'transaction') return value;
    return (...args: unknown[]) => target.transaction(() => Reflect.apply(value, receiver, args));
  },
}) : implementation;
