import { Story } from 'inkjs';
import type { ScenarioVariant } from '../content/softskills';

export type InkSnapshot = { version: 1; json: string };
const MAX_JSON=20_000;
/** Render a bounded, single-choice Ink scene without external functions or persistent variables. */
export function readInkScene(snapshot: InkSnapshot, choice?: number): { text:string; choices:string[] } {
  if(!snapshot || snapshot.version!==1 || typeof snapshot.json!=='string' || snapshot.json.length>MAX_JSON) throw Error('invalid_ink_snapshot');
  const story=new Story(snapshot.json);
  const consume=()=>{let text='';let steps=0;while(story.canContinue){if(++steps>100)throw Error('ink_step_limit');text+=story.Continue();if(text.length>10_000)throw Error('ink_text_limit');}return text.trim();};
  const initial=consume();
  if(!initial || story.currentChoices.length<1 || story.currentChoices.length>10)throw Error('invalid_ink_scene');
  if(choice===undefined)return {text:initial,choices:story.currentChoices.map(c=>c.text)};
  if(!Number.isInteger(choice)||choice<0||choice>=story.currentChoices.length)throw Error('invalid_ink_choice');
  story.ChooseChoiceIndex(choice);const ending=consume();
  if(!ending||story.currentChoices.length)throw Error('invalid_ink_ending');
  return {text:ending,choices:[]};
}
/** Reject inconsistent or corrupted saved Ink rather than falling back to another version. */
export function validateInkVariant(v:ScenarioVariant): boolean {
  if(!v.ink)return true;
  try {
    if(Object.keys(v.ink).sort().join(',')!=='json,version')return false;
    const scene=readInkScene(v.ink);
    return scene.text===v.text && scene.choices.length===v.options.length && scene.choices.every((c,i)=>c===v.options[i].text && readInkScene(v.ink!,i).text===v.options[i].note);
  } catch {return false;}
}
