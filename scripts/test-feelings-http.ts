/** Run only against an isolated development server. */
import { readFileSync } from 'node:fs';
import { FEELINGS } from '../lib/content/feelings-checkin.ts';
const base = process.env.BASE ?? 'http://localhost:3031';
for (const f of FEELINGS) {
  const response = await fetch(base + f.icon);
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok || !response.headers.get('content-type')?.includes('image/svg+xml') || !body.equals(readFileSync('public' + f.icon))) throw Error(`Asset HTTP failed: ${f.icon}`);
}
const licence = await fetch(base + '/licenses/openmoji-cc-by-sa-4.0.txt');
if (!licence.ok || !(await licence.text()).includes('Attribution-ShareAlike 4.0 International')) throw Error('License HTTP failed');
console.log('Все шесть SVG и лицензия доступны локально по HTTP без изменений');
