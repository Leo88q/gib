import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ScenarioView, { type ScenarioVariantPublic } from '../components/ScenarioView';
import { makeSessionMemory } from '../lib/postgres/session-memory';
import { startSession, selectSessionStory, publicItem } from '../lib/engine/session';
import type { AgeBand, Profile } from '../lib/types';

const dom=new JSDOM('<div id="app"></div>',{url:'https://gib.test/'});
Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const container=dom.window.document.getElementById('app')!,root=createRoot(container);
const button=(text:string)=>{const b=[...container.querySelectorAll('button')].find(x=>x.textContent?.includes(text));assert.ok(b,text);return b;};
const click=async(text:string)=>{await act(async()=>button(text).click());};
async function main(){
 for(const [band,age] of [['5-7',6],['8-10',9],['11-13',12]] as [AgeBand,number][]) for(const [scenarioId,day] of [['w1d1',0],['w1d1_music',0],['w1d1_picture',0],['w1d2',1],['w1d2_postcard',1],['w1d3',2],['w1d3_garden',2],['w1d4',3],['w1d4_bridge',3],['w1d5',4],['w1d5_puppet',4]] as const) {
  dom.window.sessionStorage.clear();
  const profile:Profile={id:'p',parentId:'owner',name:'Тест',age,band,createdAt:1};
  const mem=makeSessionMemory({profile,skills:[],sessions:[],playerStates:[],programStates:[{profileId:'p',completedDays:day,lastDayIndex:Math.max(0,day-1),startedAt:1}]});
  const started=startSession(profile,false,mem.store,{storyChoice:true,journey:true});const rt=mem.state.sessions[0].runtime!;
  const card=rt.storyOffer!.find(c=>c.scenarioId===scenarioId)!;selectSessionStory(started.sessionId,card.id,mem.store);
  const item=publicItem(mem.state.sessions[0].runtime!.items[0],band);if(item.type!=='scenario')throw Error();
  const v:ScenarioVariantPublic=item.variant;assert.ok(v.followUps);
  let submitted:{index:number;cells?:number[]} | null=null;
  const render=()=> <ScenarioView key={band} scenario={item} band={band} draftKey="story" onAnswer={async payload=>{submitted=payload;}}/>;
  await act(async()=>root.render(render()));assert.ok(container.textContent?.includes('История · 1 из 2'));
  await click(v.options[0].text);await click('Продолжить историю');assert.ok(container.textContent?.includes(v.followUps![0].text));
  assert.equal(button('Завершить историю').disabled,true);await click(v.followUps![0].choices[1]);
  await act(async()=>root.render(<div>Перерыв</div>));await act(async()=>root.render(render()));
  assert.ok(container.textContent?.includes('История восстановлена'));assert.equal(button(v.followUps![0].choices[1]).getAttribute('aria-pressed'),'true');
  await click('К первой части');await click(v.options[1].text);await click('Продолжить историю');
  assert.equal(button('Завершить историю').disabled,true);await click(v.followUps![1].choices[0]);await click('Завершить историю');
  assert.deepEqual(submitted,{index:1,cells:[0]});
 }
 assert.equal(dom.window.localStorage.length,0);await act(async()=>root.unmount());dom.window.close();
 console.log('  ok story UI: eleven stories × three ages, two choices, draft restore, change and submit');
}
main().catch(e=>{console.error(e);process.exitCode=1});
