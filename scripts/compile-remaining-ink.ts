/** Compile the existing program's day 6–60 stories to single-choice Ink scenes. */
import fs from 'node:fs';
import { Compiler, Story } from 'inkjs/full';
import { PROGRAM_DAYS, SCENARIO_BY_ID } from '../lib/content/program';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import { DAY_STORY_CARDS } from '../lib/day/story-deck';
import type { AgeBand } from '../lib/types';
const ids=[...new Set([...PROGRAM_DAYS.filter(d=>d.index>=5).map(d=>d.day.scenarioId),...DAY_STORY_CARDS.filter(c=>c.dayIndex>=5).map(c=>c.scenarioId)])].sort();
const bands:AgeBand[]=['5-7','8-10','11-13'];
const catalogs={...SCENARIO_BY_ID,...STORYLETS_BY_ID};
function safe(s:string) { if(/[\n\r\[\]{}<>#~\\]/.test(s) || /^\s*([*+\-=]|VAR |LIST |->)/.test(s)) throw Error(`ink syntax in content: ${s}`); return s; }
const outputs:{name:string;source:string;json:string}[]=[];
for(const id of ids) for(const band of bands){
 const v=catalogs[id]?.variants[band];if(!v)throw Error(`missing ${id}/${band}`);
 const source=`${safe(v.text)}\n\n${v.options.map(o=>`* [${safe(o.text)}]\n    ${safe(o.note)}\n    -> END`).join('\n')}\n`;
 const compiler=new Compiler(source);const ink=compiler.Compile();if(compiler.errors.length)throw Error(`${id}/${band}: ${compiler.errors.join(',')}`);
 const json=ink.ToJson();if(typeof json!=='string')throw Error('ink serialization failed');const run=new Story(json);let text='';while(run.canContinue)text+=run.Continue();
 if(text.trim()!==v.text||run.currentChoices.length!==v.options.length||run.currentChoices.some((c,i)=>c.text!==v.options[i].text))throw Error(`ink differs from catalog: ${id}/${band}`);
 for(let i=0;i<v.options.length;i++){const story=new Story(json);while(story.canContinue)story.Continue();story.ChooseChoiceIndex(i);let feedback='';while(story.canContinue)feedback+=story.Continue();if(feedback.trim()!==v.options[i].note||story.currentChoices.length)throw Error(`ink branch differs: ${id}/${band}/${i}`);}
 outputs.push({name:`${id}-${band}`,source,json});
}
// Validate every scene before publishing any output.
fs.mkdirSync('content/ink/remaining',{recursive:true});fs.mkdirSync('lib/content/ink/remaining',{recursive:true});
for(const {name,source,json} of outputs){fs.writeFileSync(`content/ink/remaining/${name}.ink`,source);fs.writeFileSync(`lib/content/ink/remaining/${name}.json`,json+'\n');}
let imports="import type { AgeBand } from '../types';\n", entries='';
for(let i=0;i<ids.length;i++){
 for(let j=0;j<bands.length;j++)imports+=`import ink_${i}_${j} from '../content/ink/remaining/${ids[i]}-${bands[j]}.json';\n`;
 entries+=`  '${ids[i]}': { ${bands.map((band,j)=>`'${band}': JSON.stringify(ink_${i}_${j})`).join(', ')} },\n`;
}
fs.writeFileSync('lib/engine/remaining-ink-catalog.ts',`${imports}\n/** Static compiled assets; copied into each new offer for version stability. */\nconst INK: Record<string, Record<AgeBand, string>> = {\n${entries}};\nexport function remainingInk(id: string, band: AgeBand): string | undefined { return INK[id]?.[band]; }\n`);
console.log(`compiled and checked ${ids.length} stories × ${bands.length} ages`);
