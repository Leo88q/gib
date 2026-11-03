/** Generate Ink branches from the original first-week story variants, then compile them. */
import fs from 'node:fs';
import { Compiler, Story } from 'inkjs/full';
import { SCENARIO_BY_ID } from '../lib/content/program';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import type { AgeBand } from '../lib/types';
const ids=['w1d1','w1d1_music','w1d1_picture','w1d2','w1d2_postcard','w1d3','w1d3_garden','w1d4','w1d4_bridge','w1d5','w1d5_puppet'];
const bands:AgeBand[]=['5-7','8-10','11-13'];
const catalogs={...SCENARIO_BY_ID,...STORYLETS_BY_ID};
function safe(s:string) { if(/[\n\r\[\]{}<>#~\\]/.test(s) || /^\s*([*+\-=]|VAR |LIST |->)/.test(s)) throw Error(`ink syntax in content: ${s}`); return s; }
for(const id of ids)for(const band of bands){
 const v=catalogs[id].variants[band];
 const source=`${safe(v.text)}\n\n${v.options.map(o=>`* [${safe(o.text)}]\n    ${safe(o.note)}\n    -> END`).join('\n')}\n`;
 const compiler=new Compiler(source);const ink=compiler.Compile();if(compiler.errors.length)throw Error(`${id}/${band}: ${compiler.errors.join(',')}`);
 const json=ink.ToJson();if(typeof json!=='string')throw Error('ink serialization failed');const run=new Story(json);let text='';while(run.canContinue)text+=run.Continue();
 if(text.trim()!==v.text||run.currentChoices.length!==v.options.length||run.currentChoices.some((c,i)=>c.text!==v.options[i].text))throw Error(`ink differs from catalog: ${id}/${band}`);
 for(let i=0;i<v.options.length;i++){const story=new Story(json);while(story.canContinue)story.Continue();story.ChooseChoiceIndex(i);let feedback='';while(story.canContinue)feedback+=story.Continue();if(feedback.trim()!==v.options[i].note || story.currentChoices.length)throw Error(`ink branch differs: ${id}/${band}/${i}`);}
 const name=`${id}-${band}`;fs.writeFileSync(`content/ink/week-one/${name}.ink`,source);fs.writeFileSync(`lib/content/ink/week-one/${name}.json`,json+'\n');
}
console.log('compiled and checked 11 stories × 3 ages');
