import fs from 'node:fs';
import { store } from '../lib/store.ts';
const file = process.env.GIB_DATA_FILE!;
const profile = { id: 'p', parentId: 'parent', name: 'Тест', age: 8, band: '8-10' as const, createdAt: 1 };
store.addProfile(profile);
const before = fs.readFileSync(file, 'utf8');
let failed = false;
try { store.addProfile(profile); } catch { failed = true; }
if (!failed || fs.readFileSync(file, 'utf8') !== before || store.profiles().length !== 1) throw new Error('Failed write did not preserve JSON state');
failed = false;
try { store.transaction(() => { store.all().profiles.push(profile); }); } catch { failed = true; }
if (!failed || fs.readFileSync(file, 'utf8') !== before || store.profiles().length !== 1) throw new Error('Failed transaction did not restore JSON state');
