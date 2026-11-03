/**
 * Проверка адаптивного движка: лестница сложности и оценка способности.
 * Запуск: npm run test:engine
 */
import { advance, initialSkill, pickSkills, bandOf } from '../lib/engine/adaptive.ts';
import type { SkillState } from '../lib/types.ts';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

console.log('Лестница сложности:');
let s: SkillState = { ...initialSkill('attention', '8-10') };
check('стартовый уровень = 1', s.level === 1);

const r1 = advance(s, true, 3000, 8000, '8-10');
s = { ...s, ...r1 };
check('после 1 верного уровень не растёт', s.level === 1, `уровень=${s.level}`);
check('способность растёт', s.ability > 0.35, `ability=${s.ability.toFixed(3)}`);

const r2 = advance(s, true, 3000, 8000, '8-10');
s = { ...s, ...r2 };
check('после 2 верных подряд уровень +1', s.level === 2, `уровень=${s.level}`);

const r3 = advance(s, false, 9000, 8000, '8-10');
s = { ...s, ...r3 };
check('после 1 неверного уровень не падает', s.level === 2, `уровень=${s.level}`);
const r4 = advance(s, false, 9000, 8000, '8-10');
s = { ...s, ...r4 };
check('после 2 неверных подряд уровень -1', s.level === 1, `уровень=${s.level}`);

console.log('Возрастные ограничения:');
let small: SkillState = { ...initialSkill('working_memory', '5-7') };
for (let i = 0; i < 12; i++) small = { ...small, ...advance(small, true, 1000, 8000, '5-7') };
check('5–7 лет: уровень не выше 2', small.level <= 2, `уровень=${small.level}`);

let big: SkillState = { ...initialSkill('working_memory', '11-13') };
for (let i = 0; i < 20; i++) big = { ...big, ...advance(big, true, 1000, 8000, '11-13') };
check('11–13 лет: уровень растёт выше 3', big.level >= 4, `уровень=${big.level}`);

console.log('Ротация навыков по дням:');
const states = (['attention', 'working_memory', 'flexibility', 'inhibition', 'planning', 'logic'] as const).map((skill) => ({
  ...initialSkill(skill, '8-10'),
  profileId: 'p',
}));
const day1 = pickSkills(states, 3, 0);
const day2 = pickSkills(states, 3, 2);
const day3 = pickSkills(states, 3, 4);
const union = new Set([...day1, ...day2, ...day3]);
check('за три дня покрыто >=5 навыков', union.size >= 5, `навыков=${union.size}`);
check('в каждый день ровно 3 навыка', day1.length === 3 && day2.length === 3 && day3.length === 3);

console.log('Возрастные линейки:');
check('5 лет -> 5-7', bandOf(5) === '5-7');
check('8 лет -> 8-10', bandOf(8) === '8-10');
check('13 лет -> 11-13', bandOf(13) === '11-13');

console.log(failed === 0 ? '\nВсе проверки пройдены' : `\nПровалено проверок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
