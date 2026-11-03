import { parsePendingAnswer } from '../lib/pending-answer.ts';
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const saved = { profileId: 'p1', sessionId: 's1', step: 2, steps: 4, payload: { cells: [2, 0, 1] }, ms: 3456, item: { type: 'task', instance: { kind: 'order', steps: ['а', 'б', 'в'] } } };
check(JSON.stringify(parsePendingAnswer(JSON.stringify(saved), 'p1')) === JSON.stringify(saved), 'Сохранённый ответ восстанавливается без изменения порядка');
for (const raw of [null, '', '{', 'null', JSON.stringify({ ...saved, step: 4 }), JSON.stringify({ ...saved, ms: -1 }), JSON.stringify({ ...saved, payload: [] }), JSON.stringify({ ...saved, item: null })]) {
  check(parsePendingAnswer(raw, 'p1') === null, 'Повреждённое сохранение отклоняется');
}
check(parsePendingAnswer(JSON.stringify(saved), 'p2') === null, 'Ответ не переносится между профилями');
console.log('Восстановление ответа: валидность, изоляция профиля и порядок проверены');

// Dismissing a restored result must not erase a newer pending step or another profile.
const { clearMatchingPendingAnswer, PENDING_ANSWER_KEY } = await import('../lib/pending-answer.ts');
let value: string | null = JSON.stringify(saved);
const storage = { getItem: (key: string) => key === PENDING_ANSWER_KEY ? value : null, removeItem: (key: string) => { if (key === PENDING_ANSWER_KEY) value = null; } };
clearMatchingPendingAnswer(storage, { ...saved, step: 1 });
check(value !== null, 'Предыдущий результат не удаляет новый ответ');
clearMatchingPendingAnswer(storage, { ...saved, profileId: 'p2' });
check(value !== null, 'Другой профиль не удаляет ответ');
clearMatchingPendingAnswer(storage, saved);
check(value === null, 'Результат удаляется после закрытия');
console.log('Очистка восстановленного результата: проверена изоляция шага и профиля');
