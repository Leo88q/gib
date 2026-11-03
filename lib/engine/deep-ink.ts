import { Story } from 'inkjs';
import type { ScenarioVariant } from '../content/softskills';

/** An immutable Ink tree embedded in a session; the first and second choices are unscored. */
export type DeepInkSnapshot = { version: 1; json: string };
export type DeepInkPage = { text: string; choices: string[] };
export function readDeepInk(snapshot: DeepInkSnapshot, path: readonly number[] = []): DeepInkPage {
 if(!snapshot || snapshot.version!==1 || typeof snapshot.json!=='string' || snapshot.json.length>20000 || path.length>2) throw Error('invalid_deep_ink');
 const story=new Story(snapshot.json);
 const consume=()=>{let text='',steps=0;while(story.canContinue){if(++steps>100)throw Error('deep_ink_step_limit');text+=story.Continue();if(text.length>10000)throw Error('deep_ink_text_limit');}return text.trim();};
 let text=consume();
 for(const choice of path){
  if(!Number.isInteger(choice)||choice<0||choice>=story.currentChoices.length)throw Error('invalid_deep_ink_choice');
  story.ChooseChoiceIndex(choice);text=consume();
 }
 const choices=story.currentChoices.map(c=>c.text);
 if(!text || choices.length>10 || choices.some(c=>!c || c.length>1000))throw Error('invalid_deep_ink_page');
 return {text,choices};
}
/** Deep trees are bounded and must preserve the original opening and first choices. */
export function validateDeepInkVariant(v:ScenarioVariant):boolean {
 if(v.deepInk === undefined)return true;
 if(!v.deepInk || typeof v.deepInk!=='object')return false;
 try {
  if(Object.keys(v.deepInk).sort().join(',')!=='json,version')return false;
  const first=readDeepInk(v.deepInk);
  if(first.text!==v.text || first.choices.length!==v.options.length || first.choices.length!==3 || first.choices.some((c,i)=>c!==v.options[i].text))return false;
  for(let i=0;i<first.choices.length;i++){
   const next=readDeepInk(v.deepInk,[i]);
   if(!next.text.startsWith(v.options[i].note+' ') || next.choices.length!==2 || new Set(next.choices).size!==2)return false;
   for(let j=0;j<next.choices.length;j++)if(readDeepInk(v.deepInk,[i,j]).choices.length!==0)return false;
  }
  return true;
 }catch{return false;}
}
