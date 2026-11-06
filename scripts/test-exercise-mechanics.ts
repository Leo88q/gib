import {
  DEFER_RULES,
  applySequenceAction,
  exercisePanelTitle,
  replaysBeforePractice,
  targetLabel,
  taskPresentation,
  type TaskKind,
} from '../lib/exercise/mechanics.ts';
import {
  EXERCISE_DRAFT_PREFIX,
  exerciseDraftKey,
  exerciseDraftPrefix,
  parseDigitsDraft,
  parseSingleDraft,
  removeProfileExerciseDrafts,
} from '../lib/exercise-draft.ts';
import type { AgeBand } from '../lib/types.ts';

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const BANDS: AgeBand[] = ['5-7', '8-10', '11-13'];
const KINDS: TaskKind[] = ['choice', 'memory', 'symbol-memory', 'digits', 'gonogo', 'finddiff', 'cards', 'order', 'switch-rounds', 'social-practice'];

/* --------------------------- возрастная адаптация --------------------------- */
for (const band of BANDS) {
  for (const kind of KINDS) {
    const view = taskPresentation(kind, band);
    check(view.band === band && view.instruction.length > 20, `${kind}/${band}: инструкция на месте`);
    check(view.controls === 'tap-keyboard', `${kind}/${band}: касание и клавиатура доступны`);
    check(view.showStepMs > 0 && view.showGapMs > 0, `${kind}/${band}: показ не мгновенный без уменьшения движения`);
    check(exercisePanelTitle(kind, band).length > 0, `${kind}/${band}: заголовок окна`);
    const calm = taskPresentation(kind, band, true);
    check(calm.showStepMs === 0 && calm.showGapMs === 0, `${kind}/${band}: уменьшение движения убирает подпрыгивающий показ`);
    check(calm.instruction === view.instruction && calm.freeReplays === view.freeReplays, `${kind}/${band}: режим движения не меняет правила`);
  }
  // Инструкции различаются между возрастами, а не только масштабом.
  for (const kind of KINDS) {
    const others = BANDS.filter(other => other !== band).map(other => taskPresentation(kind, other).instruction);
    check(!others.includes(taskPresentation(kind, band).instruction), `${kind}: текст отличается между возрастами`);
  }
}
const young = taskPresentation('memory', '5-7');
const middle = taskPresentation('memory', '8-10');
const teen = taskPresentation('memory', '11-13');
check(young.showStepMs > middle.showStepMs && middle.showStepMs > teen.showStepMs, 'младшим показ медленнее');
check(young.freeReplays > teen.freeReplays, 'младшим больше свободных повторов показа');
check(young.bigTargets && young.showStepBadges && !teen.bigTargets, 'крупные цели и номера — для младших');
check(replaysBeforePractice(5, '5-7') === 2 && replaysBeforePractice(5, '11-13') === 1, 'лимит повторов ограничен возрастом');

/* ------------------------- подписи и раскладка целей ------------------------- */
check(targetLabel(0, 3, '5-7') === '1 ряд, 1 место', 'младшие слышат ряд и место');
check(targetLabel(4, 3, '8-10') === 'ряд 2, столбец 2', 'средние слышат ряд и столбец');
check(targetLabel(5, 3, '11-13') === 'R2C3', 'старшие видят компактную подпись');
check(targetLabel(8, 3, '5-7') !== targetLabel(8, 4, '5-7'), 'подпись зависит от сетки');

/* ------------------------ клавиатурные действия над ответом ------------------------ */
check(JSON.stringify(applySequenceAction([], { type: 'select', index: 2 }, 9)) === '[2]', 'выбор клетки добавляется');
check(JSON.stringify(applySequenceAction([2, 0], { type: 'select', index: 0 }, 9)) === '[2,0]', 'повтор клетки в памяти запрещён');
check(JSON.stringify(applySequenceAction([2, 0], { type: 'select', index: 9 }, 9)) === '[2,0]', 'индекс за границей отклонён');
check(JSON.stringify(applySequenceAction([2, 0], { type: 'select', index: -1 }, 9)) === '[2,0]', 'отрицательный индекс отклонён');
check(JSON.stringify(applySequenceAction([2, 0], { type: 'select', index: 0.5 }, 9)) === '[2,0]', 'дробный индекс отклонён');
check(JSON.stringify(applySequenceAction([2, 0, 1], { type: 'undo' }, 9)) === '[2,0]', 'отмена убирает последний шаг');
check(JSON.stringify(applySequenceAction([], { type: 'undo' }, 9)) === '[]', 'отмена пустого выбора безопасна');
check(JSON.stringify(applySequenceAction([1, 2], { type: 'move', position: 0, direction: 1 }, 9)) === '[2,1]', 'стрелка меняет порядок плана');
check(JSON.stringify(applySequenceAction([1, 2], { type: 'move', position: 0, direction: -1 }, 9)) === '[1,2]', 'выход за верх плана не ломает выбор');
check(JSON.stringify(applySequenceAction([1, 2], { type: 'move', position: 1, direction: 1 }, 9)) === '[1,2]', 'выход за низ плана не ломает выбор');
const full = [0, 1, 2];
check(JSON.stringify(applySequenceAction(full, { type: 'select', index: 3 }, 3)) === '[0,1,2]', 'лишний шаг сверх длины не добавляется');
check(JSON.stringify(applySequenceAction(full, { type: 'focus', index: 1 }, 3)) === '[0,1,2]', 'фокус не меняет ответ');
check(JSON.stringify(applySequenceAction(full, { type: 'submit' }, 3)) === '[0,1,2]', 'отправка не меняет ответ');

/* ------------------------------- отложение ------------------------------- */
check(DEFER_RULES.optionalPractice.canDefer && DEFER_RULES.optionalPractice.rewardUnchanged, 'необязательную практику можно пропустить без потери награды');
check(!DEFER_RULES.cognitiveTask.canDefer && DEFER_RULES.cognitiveTask.rewardUnchanged, 'когнитивное задание не выдаёт ложный пропуск, награда не уменьшается');
check(DEFER_RULES.cognitiveTask.text.length > 20, 'объяснение отложения понятное');

/* --------------------------- черновик упражнения --------------------------- */
const singleSignature = JSON.stringify(['stroop', 'prompt', undefined, [{ id: 'red' }]]);
check(parseSingleDraft(JSON.stringify({ signature: singleSignature, pick: 0 }), singleSignature, 2)?.pick === 0, 'первый вариант восстанавливается (0 — валидный индекс)');
check(parseSingleDraft(JSON.stringify({ signature: singleSignature, pick: null }), singleSignature, 2)?.pick === null, 'пустой выбор допустим');
for (const raw of [null, '', '{', 'null', '[]', JSON.stringify({ signature: 'other', pick: 0 }), JSON.stringify({ signature: singleSignature, pick: 2 }), JSON.stringify({ signature: singleSignature, pick: -1 }), JSON.stringify({ signature: singleSignature, pick: 0.5 }), JSON.stringify({ signature: singleSignature, pick: '1' })]) {
  check(parseSingleDraft(raw as string | null, singleSignature, 2) === null, 'повреждённый одиночный черновик отклонён');
}
check(parseSingleDraft(JSON.stringify({ signature: singleSignature, pick: 0 }), singleSignature, 0) === null, 'без вариантов черновик не применяется');

const digitsSignature = JSON.stringify(['digit-span', [1, 2, 3]]);
check(parseDigitsDraft(JSON.stringify({ signature: digitsSignature, digits: '12' }), digitsSignature, 3)?.digits === '12', 'частичный ввод цифр восстанавливается');
check(parseDigitsDraft(JSON.stringify({ signature: digitsSignature, digits: '' }), digitsSignature, 3)?.digits === '', 'пустой ввод допустим');
for (const raw of [null, '{', JSON.stringify({ signature: 'x', digits: '1' }), JSON.stringify({ signature: digitsSignature, digits: '1234' }), JSON.stringify({ signature: digitsSignature, digits: '1a' }), JSON.stringify({ signature: digitsSignature, digits: 12 }), JSON.stringify({ signature: digitsSignature, digits: ['1'] })]) {
  check(parseDigitsDraft(raw as string | null, digitsSignature, 3) === null, 'некорректный ввод цифр отклонён');
}
check(parseDigitsDraft(JSON.stringify({ signature: digitsSignature, digits: '123456' }), digitsSignature, 7) === null, 'длина ряда сверх контракта не принимается');

check(exerciseDraftKey('p1', 's', 0, 'single') !== exerciseDraftKey('p2', 's', 0, 'single'), 'черновик изолирован по профилю');
check(exerciseDraftKey('p1', 's', 0, 'single') !== exerciseDraftKey('p1', 's', 1, 'single'), 'черновик изолирован по шагу');
check(exerciseDraftKey('p1', 's', 0, 'single') !== exerciseDraftKey('p1', 's2', 0, 'single'), 'черновик изолирован по сессии');
check(exerciseDraftKey('p1', 's', 0, 'single') !== exerciseDraftKey('p1', 's', 0, 'digits'), 'черновики разных видов не смешиваются');
check(exerciseDraftKey('p1', 's/1:2', 0, 'single').includes(encodeURIComponent('s/1:2')), 'идентификаторы экранируются');
check((EXERCISE_DRAFT_PREFIX as string).endsWith(':'), 'префикс хранилища отделён от ID');

const items = new Map<string, string>([
  [exerciseDraftKey('p1', 's', 0, 'single'), 'x'],
  [exerciseDraftKey('p1', 's', 0, 'digits'), 'x'],
  [exerciseDraftKey('p2', 's', 0, 'single'), 'x'],
  ['unrelated', 'x'],
]);
const storage = {
  get length() { return items.size; },
  key(i: number) { return [...items.keys()][i] ?? null; },
  removeItem(key: string) { items.delete(key); },
} as Storage;
removeProfileExerciseDrafts(storage, 'p1');
check([...items.keys()].every(key => !key.startsWith(exerciseDraftPrefix('p1'))) && items.size === 2, 'удаление профиля чистит только его черновики');

console.log('Механика упражнений: 10 видов × 3 возраста, клавиатура, отложение, восстановление и изоляция черновиков проверены');
