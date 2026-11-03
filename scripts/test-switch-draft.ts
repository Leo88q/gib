import { parseSwitchDraft, switchDraftKey, switchDraftPrefix, removeProfileSwitchDrafts } from '../lib/switch-draft.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw Error(message); }
const signature = JSON.stringify([[{ shape: 'circle', color: 'red' }], ['shape', 'color', 'shape']]);
const draft = { signature, round: 2, answers: [0, 1, 0] };
check(JSON.stringify(parseSwitchDraft(JSON.stringify(draft), signature, 3, 4)) === JSON.stringify(draft), 'допускаются одинаковые выборы в разных раундах');
for (const input of [null, '{', 'null', JSON.stringify({ ...draft, signature: 'other' }), JSON.stringify({ ...draft, round: 3 }), JSON.stringify({ ...draft, round: -1 }), JSON.stringify({ ...draft, answers: [0, null, 1] }), JSON.stringify({ ...draft, answers: [0, 1, 4] }), JSON.stringify({ ...draft, answers: [0, 1, 0.5] }), JSON.stringify({ ...draft, answers: [0, 1] })]) {
  check(parseSwitchDraft(input, signature, 3, 4) === null, 'повреждённый или устаревший черновик отклонён');
}
check(parseSwitchDraft(JSON.stringify({ ...draft, round: 0, answers: [null, 1, 0] }), signature, 3, 4) !== null, 'можно вернуться к первому раунду');
check(switchDraftKey('p1', 's1', 2) !== switchDraftKey('p2', 's1', 2) && switchDraftKey('p1', 's1', 2) !== switchDraftKey('p1', 's1', 1), 'изоляция профиля и шага');
const items = new Map<string, string>([[switchDraftKey('p1', 's1', 0), 'x'], [switchDraftKey('p1', 's1', 1), 'x'], [switchDraftKey('p2', 's1', 0), 'x'], ['unrelated', 'x']]);
const storage = { get length() { return items.size; }, key(i: number) { return [...items.keys()][i] ?? null; }, removeItem(key: string) { items.delete(key); } } as Storage;
removeProfileSwitchDrafts(storage, 'p1');
check([...items.keys()].every(key => !key.startsWith(switchDraftPrefix('p1'))) && items.size === 2, 'удаляются только черновики профиля');
console.log('Черновик смены правил: восстановление, повреждения и изоляция проверены');
