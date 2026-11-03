import PocketBase from 'pocketbase';
import { randomUUID } from 'node:crypto';

/** Development-only laboratory; never call from game, browser, or with real data. */
function localBase(input: string): string {
  if (process.env.NODE_ENV === 'production') throw Error('laboratory_disabled');
  const u = new URL(input);
  if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(u.hostname) || !u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('loopback_only');
  return u.origin;
}
const noRedirect: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(5000) });

/** Read only the first page of a deliberately public, synthetic content collection. */
export async function readSyntheticPocketBaseCatalog(base: string) {
  const pb = new PocketBase(localBase(base));
  const page = await pb.collection('gib_lab_stories').getList(1, 50, { fetch: noRedirect });
  if (page.page !== 1 || page.perPage !== 50 || !Number.isSafeInteger(page.totalItems) || page.totalItems < 0 || page.totalItems > 50 || !Number.isSafeInteger(page.totalPages) || page.totalPages < 0 || page.totalPages > 1 || !Array.isArray(page.items) || page.items.length !== page.totalItems) throw Error('invalid_lab_catalog');
  const seen = new Set<string>();
  return page.items.map(item => {
    if (typeof item.scenario_id !== 'string' || !/^lab_[a-z0-9_]{1,40}$/.test(item.scenario_id) || seen.has(item.scenario_id) || typeof item.title !== 'string' || !/^Тестовая история [0-9]{1,3}$/.test(item.title)) throw Error('invalid_lab_catalog');
    seen.add(item.scenario_id);
    return { scenarioId: item.scenario_id, title: item.title };
  });
}
/** Sends a fixed synthetic statement, not an application event. */
export async function sendSyntheticLrsProbe(base: string, key: string, secret: string) {
  const origin = localBase(base);
  if (!key || !secret || key.length > 200 || secret.length > 200 || key.includes(':') || /[\r\n]/.test(key+secret)) throw Error('invalid_lab_credentials');
  const statement = { id: randomUUID(), actor: { objectType: 'Agent', account: { homePage: 'https://example.invalid', name: 'synthetic-test' } }, verb: { id: 'http://adlnet.gov/expapi/verbs/completed' }, object: { objectType: 'Activity', id: 'https://example.invalid/gib-synthetic-activity' } };
  const response = await noRedirect(`${origin}/xapi/statements`, { method:'POST', headers: { 'Content-Type':'application/json', 'X-Experience-API-Version':'1.0.3', Authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }, body:JSON.stringify(statement) });
  if (response.status !== 200) throw Error(`lrs_probe_http_${response.status}`);
  const ids: unknown = await response.json();
  if (!Array.isArray(ids) || ids.length !== 1 || ids[0] !== statement.id) throw Error('invalid_lrs_receipt');
  return statement.id;
}
/** Umami receives only a fixed test event; there is no tracker on any child screen. */
export async function sendSyntheticUmamiProbe(base: string, websiteId: string) {
  const origin = localBase(base);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(websiteId)) throw Error('invalid_lab_website');
  const response = await noRedirect(`${origin}/api/send`, { method:'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({ type:'event', payload:{ website:websiteId, hostname:'example.invalid', url:'/synthetic-test', name:'gib_synthetic_probe' } }) });
  if (!response.ok) throw Error(`umami_probe_http_${response.status}`);
}
