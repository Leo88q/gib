import fs from 'node:fs';
import { Compiler, Story } from 'inkjs/full';
import { SCENARIO_BY_ID } from '../lib/content/program';
import { STORYLETS_BY_ID } from '../lib/content/storylets';
import { DAY_ONE_ALTERNATIVE_FOLLOWUPS } from '../lib/content/program/day-one-alternative-deep-story';
import { DAY_FIVE_FOLLOWUPS } from '../lib/content/program/day-five-deep-story';
import { DAY_THREE_FOUR_FOLLOWUPS } from '../lib/content/program/day-three-four-deep-story';
import { DAY_TWO_FOLLOWUPS } from '../lib/content/program/day-two-deep-story';
import { FIRST_DAY_FOLLOWUPS } from '../lib/content/program/week-one-deep-story';
import type { AgeBand } from '../lib/types';

const bands:AgeBand[]=['5-7','8-10','11-13'];
const safe=(s:string)=>{if(!s || /[\n\r\[\]{}<>#~\\]/.test(s)||/^\s*([*+\-=]|VAR |LIST |->)/.test(s))throw Error('invalid ink text');return s;};
const catalog = { w1d1: { scenario: SCENARIO_BY_ID.w1d1, followups: FIRST_DAY_FOLLOWUPS }, w1d1_music: { scenario: STORYLETS_BY_ID.w1d1_music, followups: DAY_ONE_ALTERNATIVE_FOLLOWUPS.w1d1_music }, w1d1_picture: { scenario: STORYLETS_BY_ID.w1d1_picture, followups: DAY_ONE_ALTERNATIVE_FOLLOWUPS.w1d1_picture }, w1d2: { scenario: SCENARIO_BY_ID.w1d2, followups: DAY_TWO_FOLLOWUPS.w1d2 }, w1d2_postcard: { scenario: STORYLETS_BY_ID.w1d2_postcard, followups: DAY_TWO_FOLLOWUPS.w1d2_postcard }, ...Object.fromEntries(Object.entries({...DAY_THREE_FOUR_FOLLOWUPS,...DAY_FIVE_FOLLOWUPS}).map(([id,followups]) => [id,{scenario: SCENARIO_BY_ID[id] ?? STORYLETS_BY_ID[id],followups}])) };
const results:{id:string;band:AgeBand;source:string;json:string}[]=[];
for(const [id,entry] of Object.entries(catalog)) for(const band of bands){
 const v=entry.scenario.variants[band], followups=entry.followups[band];
 const branches=v.options.map((o,i)=>{
  const f=followups[i];
  return `* [${safe(o.text)}]\n    ${safe(o.note)} ${safe(f.prompt)}\n${f.choices.map((c,j)=>`    ** [${safe(c)}]\n        ${safe(f.endings[j])}\n        -> END`).join('\n')}`;
 }).join('\n');
 const source=`${safe(v.text)}\n\n${branches}\n`;
 const compiler=new Compiler(source), story=compiler.Compile();if(compiler.errors.length)throw Error(compiler.errors.join(','));
 const json=story.ToJson();if(typeof json!=='string')throw Error('ink serialization failed');
 // Check the tree before publishing any assets.
 for(let i=0;i<3;i++)for(let j=0;j<2;j++){
  const test=new Story(json);let text='';while(test.canContinue)text+=test.Continue();
  if(text.trim()!==v.text || test.currentChoices.map(c=>c.text).join('\0')!==v.options.map(o=>o.text).join('\0'))throw Error('ink initial mismatch');
  test.ChooseChoiceIndex(i);text='';while(test.canContinue)text+=test.Continue();
  if(text.trim()!==`${v.options[i].note} ${followups[i].prompt}`||test.currentChoices.map(c=>c.text).join('\0')!==followups[i].choices.join('\0'))throw Error('ink branch mismatch');
  test.ChooseChoiceIndex(j);text='';while(test.canContinue)text+=test.Continue();
  if(text.trim()!==followups[i].endings[j]||test.currentChoices.length)throw Error('ink ending mismatch');
 }
 results.push({id,band,source,json});
}
fs.mkdirSync('content/ink/deep',{recursive:true});fs.mkdirSync('lib/content/ink/deep',{recursive:true});
for(const {id,band,source,json} of results){fs.writeFileSync(`content/ink/deep/${id}-${band}.ink`,source);fs.writeFileSync(`lib/content/ink/deep/${id}-${band}.json`,json+'\n');}
console.log(`compiled deep Ink: ${Object.keys(catalog).length} stories × 3 ages × 3 × 2 branches`);
