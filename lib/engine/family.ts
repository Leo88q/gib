import { FAMILY_CATALOG_VERSION, FAMILY_IDEAS } from '../content/family-ideas.ts';
import type { AgeBand } from '../types';

export type FamilyAction = 'choose' | 'report' | 'confirm' | 'cancel' | 'close';
export type FamilyState = {
  version: number;
  completed: number;
  current: { id: string; ideaId: string; catalogVersion: 1; status: 'chosen' | 'reported' | 'confirmed' } | null;
  receipts: { id: string; fingerprint: string }[];
};
export type FamilyCommand = { action: FamilyAction; expectedVersion: number; operationId: string; ideaId?: string };
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (obj: Record<string, unknown>, keys: string[]) => Object.keys(obj).sort().join(',') === [...keys].sort().join(',');
export const emptyFamily = (): FamilyState => ({ version: 0, completed: 0, current: null, receipts: [] });
export function validFamilyState(x: unknown): x is FamilyState {
  if (!object(x) || !exact(x, ['version','completed','current','receipts']) || !Number.isSafeInteger(x.version) || (x.version as number) < 0 || !Number.isSafeInteger(x.completed) || (x.completed as number) < 0 || (x.completed as number) > (x.version as number) || !Array.isArray(x.receipts) || x.receipts.length > 64) return false;
  if (!x.receipts.every(r => object(r) && exact(r, ['id', 'fingerprint']) && typeof r.id === 'string' && idPattern.test(r.id) && typeof r.fingerprint === 'string' && r.fingerprint.length <= 180) || new Set(x.receipts.map(r => r.id)).size !== x.receipts.length) return false;
  if (x.current === null) return true;
  const c = x.current;
  return object(c) && exact(c, ['id','ideaId','catalogVersion','status']) && typeof c.id === 'string' && idPattern.test(c.id) && typeof c.ideaId === 'string' && FAMILY_IDEAS.some(idea => idea.id === c.ideaId) && c.catalogVersion === FAMILY_CATALOG_VERSION && ['chosen','reported','confirmed'].includes(String(c.status));
}
/** No actor identity can be inferred: one platform account currently controls child and parent views. */
export function advanceFamily(state: FamilyState, command: FamilyCommand, instanceId: string): { state: FamilyState; replay: boolean } | { error: 'invalid_action' | 'operation_conflict' | 'version_conflict' | 'invalid_transition' } {
  if (!validFamilyState(state) || !command || typeof command !== 'object' || Array.isArray(command) || !['choose','report','confirm','cancel','close'].includes(command.action) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 0 || typeof command.operationId !== 'string' || !idPattern.test(command.operationId) || !idPattern.test(instanceId)) return { error: 'invalid_action' };
  if (command.action === 'choose' ? typeof command.ideaId !== 'string' || !FAMILY_IDEAS.some(idea => idea.id === command.ideaId) : command.ideaId !== undefined) return { error: 'invalid_action' };
  const fingerprint = `${command.action}|${command.expectedVersion}|${command.ideaId ?? ''}`;
  const receipt = state.receipts.find(r => r.id === command.operationId);
  if (receipt) return receipt.fingerprint === fingerprint ? { state: structuredClone(state), replay: true } : { error: 'operation_conflict' };
  if (state.version !== command.expectedVersion) return { error: 'version_conflict' };
  if (state.version >= Number.MAX_SAFE_INTEGER) return { error: 'invalid_transition' };
  const next = structuredClone(state);
  switch (command.action) {
    case 'choose': if (next.current) return { error: 'invalid_transition' }; next.current = { id: instanceId, ideaId: command.ideaId!, catalogVersion: FAMILY_CATALOG_VERSION, status: 'chosen' }; break;
    case 'report': if (next.current?.status !== 'chosen') return { error: 'invalid_transition' }; next.current.status = 'reported'; break;
    case 'confirm': if (next.current?.status !== 'reported') return { error: 'invalid_transition' }; next.current.status = 'confirmed'; next.completed++; break;
    case 'cancel': if (!next.current || next.current.status === 'confirmed') return { error: 'invalid_transition' }; next.current = null; break;
    case 'close': if (next.current?.status !== 'confirmed') return { error: 'invalid_transition' }; next.current = null; break;
  }
  next.version++;
  next.receipts.push({ id: command.operationId, fingerprint });
  if (next.receipts.length > 64) next.receipts.shift();
  return { state: next, replay: false };
}
export function publicFamily(state: FamilyState, band: AgeBand) {
  const ideas = FAMILY_IDEAS.map(i => ({ id: i.id, title: i.title, prompt: i.prompt[band] }));
  const selected = state.current ? ideas.find(i => i.id === state.current!.ideaId)! : null;
  return { version: state.version, completed: state.completed, target: 5, ideas, current: state.current && selected ? { instanceId: state.current.id, status: state.current.status, ...selected } : null };
}
