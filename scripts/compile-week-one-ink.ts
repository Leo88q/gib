/** Generate Ink branches from the original first-week story variants, then compile them. */
import fs from 'node:fs';
import { Compiler, Story } from 'inkjs/full';
import { SCENARIO_BY_ID, PROGRAM_DAYS } from '../lib/content/program';
import { DAY_STORY_CARDS } from '../lib/day/story-deck';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import type { AgeBand } from '../lib/types';
// Список выводится из контента, а не переписывается руками: иначе новая
// карточка в первый день молча остаётся без ink-сцены, и сессия падает.
const ids=[...new Set([
  ...PROGRAM_DAYS.filter(d=>d.index<5).map(d=>d.day.scenarioId),
  ...DAY_STORY_CARDS.filter(c=>c.dayIndex<5).map(c=>c.scenarioId),
])].sort();
const bands:AgeBand[]=['5-7','8-10','11-13'];
const outputs:{name:string,json:string}[]=[];
const catalogs={...SCENARIO_BY_ID,...STORYLETS_BY_ID};
function safe(s:string) { if(/[\n\r\[\]{}<>#~\\]/.test(s) || /^\s*([*+\-=]|VAR |LIST |->)/.test(s)) throw Error(`ink syntax in content: ${s}`); return s; }
for(const id of ids)for(const band of bands){
 const v=catalogs[id].variants[band];
 const source=`${safe(v.text)}\n\n${v.options.map(o=>`* [${safe(o.text)}]\n    ${safe(o.note)}\n    -> END`).join('\n')}\n`;
 const compiler=new Compiler(source);const ink=compiler.Compile();if(compiler.errors.length)throw Error(`${id}/${band}: ${compiler.errors.join(',')}`);
 const json=ink.ToJson();if(typeof json!=='string')throw Error('ink serialization failed');const run=new Story(json);let text='';while(run.canContinue)text+=run.Continue();
 if(text.trim()!==v.text||run.currentChoices.length!==v.options.length||run.currentChoices.some((c,i)=>c.text!==v.options[i].text))throw Error(`ink differs from catalog: ${id}/${band}`);
 for(let i=0;i<v.options.length;i++){const story=new Story(json);while(story.canContinue)story.Continue();story.ChooseChoiceIndex(i);let feedback='';while(story.canContinue)feedback+=story.Continue();if(feedback.trim()!==v.options[i].note || story.currentChoices.length)throw Error(`ink branch differs: ${id}/${band}/${i}`);}
 const name=`${id}-${band}`;fs.writeFileSync(`content/ink/week-one/${name}.ink`,source);fs.writeFileSync(`lib/content/ink/week-one/${name}.json`,json+'\n');outputs.push({name,json});
}
// Каталог генерируется, а не правится руками: иначе новая сцена компилируется,
// но до движка не доходит — он читает именно этот файл.
let imports="import type { AgeBand } from '../types';\n",entries='';
for(let i=0;i<ids.length;i++){
 for(let j=0;j<bands.length;j++)imports+=`import ink_${i}_${j} from '../content/ink/week-one/${ids[i]}-${bands[j]}.json';\n`;
 entries+=`  '${ids[i]}': { ${bands.map((band,j)=>`'${band}': JSON.stringify(ink_${i}_${j})`).join(', ')} },\n`;
}
fs.writeFileSync('lib/engine/week-one-ink-catalog.ts',`${imports}\n/** Static compiled assets; copied into each new offer for version stability. */\nconst WEEK_ONE_INK: Record<string, Record<AgeBand, string>> = {\n${entries}};\nexport function weekOneInk(scenarioId: string, band: AgeBand): string | undefined { return WEEK_ONE_INK[scenarioId]?.[band]; }\n`);
console.log(`compiled and checked ${ids.length} stories × ${bands.length} ages`);
