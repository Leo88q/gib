/**
 * Карта соответствия «навыки продукта ↔ конструкты исследования».
 *
 * Зачем. Исследование (сценарий видео, показатель R4) измеряет шесть
 * конструктов: самосознание и эмоции, эмпатия, коммуникация и договорённость,
 * командная работа, саморегуляция, уверенность в выступлении. Продукт размечен
 * по 48 навыкам в семи компетенциях. Это разные списки, и пока их никто не
 * сопоставил, любое «исследование подтверждает продукт» — утверждение без
 * основания.
 *
 * Скрипт печатает карту и считается покрытие. Он не решает, какие навыки
 * относятся к конструктам, — это методическое решение, зафиксированное здесь
 * явными списками, чтобы его можно было оспорить, а не искать по коду.
 *
 * Запуск: npx tsx scripts/map-research-constructs.ts
 * Печатает то же, что docs/research-construct-map.md; при расхождении прав
 * документ, а не вывод.
 */
import { SKILLS_CATALOG, SKILL_BY_ID } from '../lib/content/skills-catalog.ts';
import { STORY_SKILLS } from '../lib/content/story-skills.ts';
import { PROGRAM, PROGRAM_DAYS } from '../lib/content/program/index.ts';

/**
 * Шесть конструктов исследования. Три первых совпадают с компетенциями
 * продукта целиком, поэтому заданы идентификаторами компетенций.
 */
const BY_COMPETENCY: Record<string, readonly string[]> = {
  'самосознание и эмоции': ['self_awareness'],
  'эмпатия': ['empathy'],
  'саморегуляция': ['self_regulation'],
};

/**
 * Коммуникация и договорённость — только ядро из компетенции `relationships`.
 * Остальные её навыки (вступать в игру) относятся к команде, а не к речи.
 */
const COMMUNICATION = [
  'ask_help', 'offer_help', 'accept_refusal', 'say_no', 'apologize', 'agree_rules', 'handle_conflict',
] as const;

/**
 * Планирование и организация отнесены к саморегуляции.
 *
 * Это методическое решение, и его надо назвать: конструкт «саморегуляция» в
 * исследовании описан как управление своим состоянием и действием. План шагов,
 * порядок и пересборка при сбое — это управление действием, а не чувством.
 * Основание добавить их к конструкту: иначе тема 10 «План и порядок» остаётся
 * вне измерения (0%), хотя это единственная тема, где планирование прямо
 * тренируется.
 */
const PLANNING = ['plan_steps', 'change_plan', 'order_steps', 'first_things_first', 'rebuild_plan'] as const;

/** Командная работа: вступить в игру, своя роль и поддержка партнёра. */
const TEAMWORK = ['join_group', 'take_role', 'support_group'] as const;

/**
 * Уверенность в выступлении: показать свою идею и выйти показывать работу.
 * Второй навык добавлен 06.11.2026 — до этого кульминация актёрской методики
 * в каталоге отсутствовала.
 */
const PERFORMANCE = ['show_idea', 'show_work'] as const;

function buildCoverage(): Map<string, string> {
  const coverage = new Map<string, string>();
  for (const [construct, competencies] of Object.entries(BY_COMPETENCY)) {
    for (const skill of SKILLS_CATALOG) {
      if (competencies.includes(skill.competency)) coverage.set(skill.id, construct);
    }
  }
  // Явные списки идут после компетенций и перебивают их: show_work формально
  // лежит в саморегуляции (ядро — справиться с волнением), но измеряется как
  // «уверенность в выступлении». Без этого он считался бы в чужом конструкте.
  for (const id of PLANNING) coverage.set(id, 'саморегуляция');
  for (const id of COMMUNICATION) coverage.set(id, 'коммуникация и договорённость');
  for (const id of TEAMWORK) coverage.set(id, 'командная работа');
  for (const id of PERFORMANCE) coverage.set(id, 'уверенность в выступлении');
  return coverage;
}

function main() {
  const coverage = buildCoverage();
  const total = SKILLS_CATALOG.length;

  // Проверка целостности: каждый явный id существует и сам о себе не врёт.
  for (const id of [...COMMUNICATION, ...TEAMWORK, ...PERFORMANCE]) {
    if (!SKILL_BY_ID[id]) throw new Error(`навык ${id} из карты отсутствует в каталоге`);
  }
  // Новые навыки лежат в других компетенциях и потому не попадают в первые
  // три конструкта автоматически. Проверяем, что явный список не перебивает
  // компетенцию молча: у навыка должен остаться ровно один конструкт.
  for (const id of [...PLANNING, ...COMMUNICATION, ...TEAMWORK, ...PERFORMANCE]) {
    const hits = [...coverage].filter(([skillId]) => skillId === id);
    if (hits.length !== 1) throw new Error(`${id} попал в несколько конструктов`);
  }

  console.log('Покрытие по конструктам исследования\n');
  const byConstruct = new Map<string, string[]>();
  for (const [skillId, construct] of coverage) {
    const list = byConstruct.get(construct) ?? [];
    list.push(skillId);
    byConstruct.set(construct, list);
  }
  for (const [construct, ids] of byConstruct) {
    console.log(`  ${construct}: ${ids.length}`);
  }

  const covered = coverage.size;
  const uncovered = SKILLS_CATALOG.filter(skill => !coverage.has(skill.id)).map(skill => skill.id);
  console.log(`\n  покрыто: ${covered} из ${total} (${Math.round((covered / total) * 100)}%)`);
  console.log(`  не покрыто: ${uncovered.length} (${Math.round((uncovered.length / total) * 100)}%)`);

  // Непокрытое по компетенциям: так видно, что не измеряется вовсе.
  const uncoveredByCompetency = new Map<string, string[]>();
  for (const id of uncovered) {
    const competency = SKILL_BY_ID[id]?.competency ?? '?';
    uncoveredByCompetency.set(competency, [...(uncoveredByCompetency.get(competency) ?? []), id]);
  }
  console.log('\nНе покрыто по компетенциям:');
  for (const [competency, ids] of uncoveredByCompetency) console.log(`  ${competency}: ${ids.join(', ')}`);

  console.log('\nПо неделям программы:');
  const thin: number[] = [];
  for (const week of PROGRAM) {
    const days = PROGRAM_DAYS.filter(entry => entry.week.week === week.week);
    const skills = new Set<string>();
    for (const day of days) {
      for (const skill of STORY_SKILLS[String(day.day.scenarioId)]?.skills ?? []) skills.add(skill);
    }
    const inside = [...skills].filter(skill => coverage.has(skill)).length;
    const share = skills.size ? Math.round((inside / skills.size) * 100) : 0;
    if (share < 40) thin.push(week.week);
    console.log(`  неделя ${String(week.week).padStart(2)} · ${week.title.padEnd(24)} навыков ${String(skills.size).padStart(2)} · в конструктах ${String(inside).padStart(2)} = ${String(share).padStart(3)}%`);
  }

  // Не падаем: карта — это наблюдение, а не проходной тест. Но о проблемных
  // неделях говорим прямо, чтобы слабое место не терялось в таблице.
  if (thin.length) {
    console.log(`\n⚠️  Недели, которые исследование почти не измеряет: ${thin.join(', ')}`);
  }
  console.log('\nРешение, что с этим делать: docs/research-construct-map.md, раздел 4.');
}

main();
