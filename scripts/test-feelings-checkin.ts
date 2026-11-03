import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FEELINGS, FEELING_PROMPTS, toggleFeeling, type FeelingId } from '../lib/content/feelings-checkin.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw new Error(message); }
const hashes: Record<string, string> = {
  '/openmoji/1F60A.svg': 'e2ae6cedba1d340fae93935618164cb2909cbf1e041484fc42005728b94f90d9',
  '/openmoji/1F60C.svg': '97a515ade6092b99626650004dd93565e925dfa198a5e1ee9e207f8c807d6676',
  '/openmoji/1F621.svg': 'c55c039c666267fdbc4e0889c10521f9ca5553aa4565ee1ab37ad4e92e4b8715',
  '/openmoji/1F622.svg': '7539906580ea9bf17ba129522842262dd8ad5c2d367d517eb4f96544a3c02320',
  '/openmoji/1F628.svg': 'de53fa035dc058b488bc051a210d9efff361ee3587a3a3d79f62310deeca839f',
  '/openmoji/1F914.svg': 'eadd96d61939689ac418e26c2852cc681a4cab336ba2ae5514d9495879ee172f',
};
check(FEELINGS.length === 6 && new Set(FEELINGS.map(f => f.id)).size === 6 && new Set(FEELINGS.map(f => f.icon)).size === 6, 'значки уникальны');
for (const item of FEELINGS) {
  const bytes = readFileSync(`public${item.icon}`);
  check(createHash('sha256').update(bytes).digest('hex') === hashes[item.icon], 'неизменённый исходный OpenMoji');
  check(!/<script\b|<foreignObject\b|\bon\w+\s*=|\b(?:href|src)\s*=/i.test(bytes.toString()), 'в SVG нет активного содержимого и внешних ссылок');
  check(item.label.length > 0, 'текстовая подпись доступна');
}
check(readFileSync('public/licenses/openmoji-cc-by-sa-4.0.txt', 'utf8').includes('Attribution-ShareAlike 4.0 International'), 'лицензия опубликована');
for (const band of ['5-7', '8-10', '11-13'] as const) check(FEELING_PROMPTS[band].includes('пропустить'), 'добровольность для каждого возраста');
let selected: FeelingId[] = [];
selected = toggleFeeling(selected, 'joy'); selected = toggleFeeling(selected, 'sad');
check(selected.join(',') === 'joy,sad', 'несколько чувств');
selected = toggleFeeling(selected, 'unsure'); check(selected.join(',') === 'unsure', 'неопределённость исключает остальные варианты');
selected = toggleFeeling(selected, 'fear'); check(selected.join(',') === 'fear', 'выбор слова заменяет неопределённость');
selected = toggleFeeling(selected, 'fear'); check(selected.length === 0, 'выбор можно отменить');
console.log('OpenMoji и отметки чувств: атрибуция, файлы, возрастные инструкции и логика выбора проверены');
