/**
 * Карта навыков в терминале: что покрыто, что нет, где разметка расходится.
 *
 * Запуск: npm run skills:map
 * С фильтром: npm run skills:map -- empathy
 *
 * Это не отчёт ребёнку и не отчёт родителю. Внутренний инструмент: он
 * показывает, где учебная часть заявлена, но не отработана. Ничего не
 * оценивает и никого не ранжирует.
 */
import { SKILLS_CATALOG, SKILLS_PER_COMPETENCY, skillsForCompetency } from '../lib/content/skills-catalog.ts';
import { STORY_SKILLS, coveredSkillIds, storiesForSkill } from '../lib/content/story-skills.ts';
import { COMPETENCY_LABELS } from '../lib/content/softskills.ts';
import type { CompetencyId } from '../lib/types.ts';

const filter = process.argv[2] as CompetencyId | undefined;
const competencies = Object.keys(SKILLS_PER_COMPETENCY) as CompetencyId[];
const covered = coveredSkillIds();
const stories = Object.keys(STORY_SKILLS).length;

if (filter && !competencies.includes(filter)) {
  console.error(`Неизвестная компетенция: ${filter}`);
  console.error(`Доступные: ${competencies.join(', ')}`);
  process.exit(1);
}

console.log(`\nКарта навыков — ${SKILLS_CATALOG.length} навыков, ${stories} историй\n`);
console.log('Компетенция                 покрыто  сцен*  навыки без сцен');
console.log('* сцен — историй, где тренируется хотя бы один навык компетенции;');
console.log('  одна история может относиться к нескольким компетенциям.');
console.log('─'.repeat(72));

for (const competency of competencies) {
  if (filter && competency !== filter) continue;
  const skills = skillsForCompetency(competency);
  const done = skills.filter(skill => covered.has(skill.id));
  const storyCount = new Set(skills.flatMap(skill => storiesForSkill(skill.id))).size;
  const missing = skills.filter(skill => !covered.has(skill.id));
  const coverage = `${done.length}/${skills.length}`;
  const gaps = missing.length ? missing.map(skill => skill.id).join(' ') : '—';
  console.log(`${COMPETENCY_LABELS[competency].padEnd(26)} ${coverage.padStart(8)} ${String(storyCount).padStart(7)}  ${gaps}`);
}

/* Детализация по навыкам выбранной компетенции. */
if (filter) {
  console.log(`\nНавыки: ${COMPETENCY_LABELS[filter]}\n`);
  for (const skill of skillsForCompetency(filter)) {
    const ids = storiesForSkill(skill.id);
    const mark = ids.length === 0 ? '✗' : ids.length === 1 ? '·' : '✓';
    console.log(`${mark} ${skill.id}`);
    console.log(`  ${skill.title}`);
    console.log(`  истории: ${ids.length ? ids.join(', ') : 'нет'}`);
  }
}

/* Что тренирует каждая история — чтобы правки контента были осознанными. */
if (process.env.SKILLS_VERBOSE === '1') {
  console.log('\nИстория → навыки\n');
  for (const [storyId, entry] of Object.entries(STORY_SKILLS)) {
    console.log(`${storyId}: ${entry.skills.join(', ')}`);
  }
}

/* Итог по покрытию. */
const uncovered = SKILLS_CATALOG.filter(skill => !covered.has(skill.id));
const single = SKILLS_CATALOG.filter(skill => storiesForSkill(skill.id).length === 1);
console.log('\n' + '─'.repeat(72));
console.log(`Покрыто: ${covered.size}/${SKILLS_CATALOG.length}`);
console.log(`Без историй: ${uncovered.length}${uncovered.length ? ' — ' + uncovered.map(s => s.id).join(' ') : ''}`);
console.log(`Только одна история: ${single.length}${single.length ? ' — ' + single.map(s => s.id).join(' ') : ''}`);
