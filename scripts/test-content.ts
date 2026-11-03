import { WEEKS_NINE_TWELVE_STORY_OPTIONS } from '../lib/content/program/weeks-nine-twelve-story-options.ts';
import { WEEKS_SIX_EIGHT_STORY_OPTIONS } from '../lib/content/program/weeks-six-eight-story-options.ts';
import { WEEKS_FOUR_FIVE_STORY_OPTIONS } from '../lib/content/program/weeks-four-five-story-options.ts';
/**
 * Проверка целостности контента программы.
 * Запуск: npm run test:content
 */
import { PROGRAM, PROGRAM_DAYS, PROGRAM_SCENARIOS, SCENARIO_BY_ID, TOTAL_DAYS } from '../lib/content/program/index.ts';
import { SCENARIOS as BASE_SCENARIOS } from '../lib/content/softskills.ts';
import { TASKS } from '../lib/content/cognitive.ts';
import { STORYLET_SCENARIOS } from '../lib/content/storylets.ts';
import { REFLECTIONS } from '../lib/content/reflection.ts';

const BANDS = ['5-7', '8-10', '11-13'] as const;
const TASK_IDS = new Set(TASKS.map((t) => t.id));

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

console.log('Вопросы для размышления:');
check('каждая компетенция программы имеет шаг размышления', PROGRAM.every(w => !!REFLECTIONS[w.competency]));
check('у каждого шага есть вопрос, варианты и ответы Лиса', Object.values(REFLECTIONS).every(r => r.prompt && r.choices.length >= 2 && r.choices.every(c => c.label && c.response)));

console.log('Структура программы:');
check('12 недель', PROGRAM.length === 12, `недель=${PROGRAM.length}`);
check('в каждой неделе 5 дней', PROGRAM.every((w) => w.days.length === 5));
check('всего 60 дней', TOTAL_DAYS === 60, `дней=${TOTAL_DAYS}`);
check('номера недель 1..12 без пропусков', PROGRAM.every((w, i) => w.week === i + 1));
check('дни внутри недели 1..5', PROGRAM.every((w) => w.days.every((d, i) => d.day === i + 1)));
check(
  'у каждого дня есть тема, навык и цель для родителя',
  PROGRAM.every((w) => w.days.every((d) => d.theme && d.focus && d.parentGoal && d.skills.length === 3))
);
check(
  'у каждой недели есть цель, идеи для дома и вопрос',
  PROGRAM.every((w) => w.parentNote && w.homeIdeas.length >= 2 && w.weekQuestion)
);

console.log('Сценарии:');
check('60 программных сценариев', PROGRAM_SCENARIOS.length === 60, `сценариев=${PROGRAM_SCENARIOS.length}`);
const ids = PROGRAM_SCENARIOS.map((s) => s.id);
check('идентификаторы уникальны', new Set(ids).size === ids.length);
check(
  'идентификаторы не пересекаются с базовыми',
  !ids.some((id) => BASE_SCENARIOS.some((b) => b.id === id))
);
check(
  'каждый день ссылается на существующий сценарий',
  PROGRAM_DAYS.every((d) => Boolean(SCENARIO_BY_ID[d.day.scenarioId]))
);
check(
  'идентификатор сценария совпадает с неделей и днём (wXдY)',
  PROGRAM_DAYS.every((d) => d.day.scenarioId === `w${d.week.week}d${d.day.day}`)
);
check(
  'на каждую неделю ровно 5 сценариев',
  PROGRAM.every((w) => new Set(w.days.map((d) => d.scenarioId)).size === 5)
);

check('дополнительные истории не пересекаются с программой и имеют три возраста', STORYLET_SCENARIOS.length === 61 && STORYLET_SCENARIOS.every(sc => !ids.includes(sc.id) && BANDS.every(b => !!sc.variants[b]?.title && !!sc.variants[b]?.text && sc.variants[b].options.length === 3 && sc.variants[b].options.every(o => o.text && o.note)) && TASK_IDS.has(sc.practiceTaskId)));

let variantProblems = 0;
const problemDetails: string[] = [];
for (const sc of PROGRAM_SCENARIOS) {
  for (const band of BANDS) {
    const v = sc.variants[band];
    if (!v) {
      variantProblems += 1;
      problemDetails.push(`${sc.id}/${band}: нет варианта`);
      continue;
    }
    if (!v.title || !v.text) {
      variantProblems += 1;
      problemDetails.push(`${sc.id}/${band}: пустой заголовок или текст`);
    }
    if (v.options.length !== 3) {
      variantProblems += 1;
      problemDetails.push(`${sc.id}/${band}: вариантов ${v.options.length}, ожидалось 3`);
    }
    const qualities = v.options.map((o) => o.quality).sort();
    if ((WEEKS_FOUR_FIVE_STORY_OPTIONS[sc.id] || WEEKS_SIX_EIGHT_STORY_OPTIONS[sc.id] || WEEKS_NINE_TWELVE_STORY_OPTIONS[sc.id]) ? v.options.some(o => o.quality !== undefined) : qualities.join(',') !== 'bad,good,partial') {
      variantProblems += 1;
      problemDetails.push(`${sc.id}/${band}: набор решений ${qualities.join(',')}`);
    }
    for (const o of v.options) {
      if (!o.text || !o.note) {
        variantProblems += 1;
        problemDetails.push(`${sc.id}/${band}: пустой вариант или разбор`);
      }
    }
  }
  if (!sc.practiceTaskId || !TASK_IDS.has(sc.practiceTaskId)) {
    variantProblems += 1;
    problemDetails.push(`${sc.id}: неизвестное задание ${sc.practiceTaskId}`);
  }
  if (!sc.home || !sc.report || !sc.growth || !sc.question) {
    variantProblems += 1;
    problemDetails.push(`${sc.id}: не заполнены home/report/growth/question`);
  }
  if (!sc.competency || !sc.skillLabel) {
    variantProblems += 1;
    problemDetails.push(`${sc.id}: не задана компетенция`);
  }
}
check('все варианты, разборы и привязки заполнены', variantProblems === 0, problemDetails.slice(0, 5).join(' | '));

const competencyUse = new Set(PROGRAM_SCENARIOS.map((s) => s.competency));
check('использованы все 7 компетенций', competencyUse.size === 7, `компетенций=${competencyUse.size}`);

console.log(failed === 0 ? '\nВсе проверки контента пройдены' : `\nПровалено проверок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
