import fs from 'node:fs';
import { PROGRAM } from '../lib/content/program/index.ts';
import { DEFAULT_ART, skillArt, competencyArt, weekArt } from '../lib/art-paths.ts';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function checkImage(path: string) {
  if (!path.startsWith('/art/') || path.includes('..')) throw new Error(`Unsafe asset path: ${path}`);
  const bytes = fs.readFileSync(`public${path}`);
  if (bytes.length < 1024 || !bytes.subarray(0, 8).equals(signature)) throw new Error(`Invalid PNG: ${path}`);
}
for (const skill of ['attention','working_memory','flexibility','inhibition','planning','logic']) checkImage(skillArt(skill));
for (const competence of ['self_awareness','self_regulation','empathy','relationships','decision_making','creative_thinking','growth_mindset']) checkImage(competencyArt(competence));
for (const week of PROGRAM) {
  checkImage(weekArt(week.week, week.competency));
  if (weekArt(week.week, week.competency) !== `/art/week-${String(week.week).padStart(2, '0')}.png`) throw new Error(`Missing bespoke art for week ${week.week}`);
}
if (skillArt('other') !== DEFAULT_ART || competencyArt('other') !== DEFAULT_ART || weekArt(0, 'other') !== DEFAULT_ART) throw new Error('Unknown IDs must use safe fallback');
console.log('Проверены существующие PNG для всех навыков, компетенций и двенадцати отдельных недель.');
