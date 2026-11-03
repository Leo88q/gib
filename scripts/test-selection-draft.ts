import { parseSelectionDraft, selectionDraftKey, selectionDraftPrefix, removeProfileSelectionDrafts } from '../lib/selection-draft.ts';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const draft = { signature: 'order', picked: [2, 0, 1] };
check(JSON.stringify(parseSelectionDraft(JSON.stringify(draft), 'order', 3)) === JSON.stringify(draft), 'порядок сохраняется');
for (const raw of [null, '{', 'null', JSON.stringify({ ...draft, signature: 'other' }), JSON.stringify({ ...draft, picked: [0, 0] }), JSON.stringify({ ...draft, picked: [-1] }), JSON.stringify({ ...draft, picked: [3] }), JSON.stringify({ ...draft, picked: [0.5] }), JSON.stringify({ ...draft, picked: '1' })]) check(parseSelectionDraft(raw, 'order', 3) === null, 'повреждённый черновик отклонён');
check(parseSelectionDraft(JSON.stringify({ ...draft, picked: [] }), 'order', 3) !== null, 'пустой выбор допустим');
check(selectionDraftKey('p1', 's', 0) !== selectionDraftKey('p2', 's', 0) && selectionDraftKey('p1', 's', 0) !== selectionDraftKey('p1', 's', 1), 'изоляция');
const data = new Map([[selectionDraftKey('p1', 's', 0), 'a'], [selectionDraftKey('p2', 's', 0), 'b'], ['other', 'c']]);
const storage = { get length() { return data.size; }, key(i: number) { return [...data.keys()][i] ?? null; }, removeItem(k: string) { data.delete(k); } } as Storage;
removeProfileSelectionDrafts(storage, 'p1');
check(data.size === 2 && [...data.keys()].every(k => !k.startsWith(selectionDraftPrefix('p1'))), 'очистка только своего профиля');
console.log('Черновики выбора: порядок, границы, изоляция и удаление проверены');
