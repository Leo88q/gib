/** Real headless Chromium against a disposable, authenticated demo server. Not a Telegram/MAX WebView. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright-core';

const require=createRequire(import.meta.url);
const chrome=require('@sparticuz/chromium');
const chromeDir=path.dirname(require.resolve('@sparticuz/chromium'));
const LambdaFS=require(path.join(chromeDir,'lambdafs.js')).default;
const url=new URL(process.env.BROWSER_TEST_BASE ?? 'http://127.0.0.1:3095');
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.search||url.hash) throw Error('browser test requires a disposable numeric-loopback server');
const base=url.origin;
const tokens={telegram:process.env.BROWSER_TEST_TELEGRAM_TOKEN, max:process.env.BROWSER_TEST_MAX_TOKEN};
if(process.env.NODE_ENV==='production'||process.env.GIB_BROWSER_DISPOSABLE!=='1'||tokens.telegram!=='browser-test-telegram-token'||tokens.max!=='browser-test-max-token')throw Error('explicit disposable server with fixed synthetic tokens required');
function signed(token:string,id:number){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Synthetic'})});const s=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');const key=crypto.createHmac('sha256','WebAppData').update(token).digest();p.set('hash',crypto.createHmac('sha256',key).update(s).digest('hex'));return p.toString();}
async function responseFor(page:Page, action:string, click:()=>Promise<unknown>){
 let r:import('playwright-core').Response;
 try { [r]=await Promise.all([page.waitForResponse(r=>r.url()===`${base}/api/session` && r.request().method()==='POST' && r.request().postDataJSON()?.action===action),click()]); }
 catch (error) { console.error('response wait failed, visible screen:',(await page.locator('body').innerText()).slice(-2500)); throw error; }
 assert.equal(r.status(),200,await r.text());return r.json();
}
async function assertNoHorizontalOverflow(page:Page){const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,`horizontal overflow: ${JSON.stringify(sizes)}`);}
async function welcome(page:Page){await page.getByRole('button',{name:'Начать миссию'}).click();await page.getByRole('button',{name:'Продолжить →',exact:true}).click();}
async function task(page:Page,item:any){
 const x=item.instance;
 if(x.kind==='choice'){await page.locator('.options .option').first().click();await page.getByRole('button',{name:'Подтвердить выбор'}).click();}
 else if(x.kind==='cards'){await page.locator('.card-shape').first().click();await page.getByRole('button',{name:'Подтвердить выбор'}).click();}
 else if(x.kind==='gonogo'||x.kind==='finddiff'){await page.getByRole('button',{name:'Готово',exact:true}).click();}
 else if(x.kind==='order'){const buttons=page.locator('.order-card');for(let i=0;i<x.steps.length;i++)await buttons.nth(i).click();await page.getByRole('button',{name:'Проверить план'}).click();}
 else if(x.kind==='memory'||x.kind==='symbol-memory'){await page.getByRole('button',{name:'Готово',exact:true}).waitFor({state:'visible',timeout:30000});for(let i=0;i<x.cells.length;i++)await page.locator('.grid.cells button').nth(i).click();await page.getByRole('button',{name:'Готово',exact:true}).click();}
 else if(x.kind==='digits'){await page.getByRole('button',{name:'Проверить',exact:true}).waitFor({state:'visible',timeout:30000});for(let i=0;i<x.digits.length;i++)await page.locator('.keypad .key').first().click();await page.getByRole('button',{name:'Проверить',exact:true}).click();}
 else if(x.kind==='switch-rounds'){for(let i=0;i<x.rules.length;i++){await page.locator('.card-shape').first().click();await page.getByRole('button',{name:i===x.rules.length-1?'Проверить ответы':'Следующее правило →'}).click();}}
 else throw Error(`unhandled task ${x.kind}`);
}
async function main(){
 await LambdaFS.inflate(path.join(chromeDir,'../bin/al2023.tar.br'));
 const env={...process.env,LD_LIBRARY_PATH:`/tmp/al2023/lib:${process.env.LD_LIBRARY_PATH??''}`};
 // No cross-origin or mixed-content bypass. --no-sandbox is restricted to this disposable browser/test.
 const args=chrome.args.filter((x:string)=>x!=='--disable-web-security'&&x!=='--allow-running-insecure-content');
 for(const [platform,age] of [['telegram',6],['max',9],['telegram',12]] as const){
  const browser=await chromium.launch({executablePath:await chrome.executablePath(),args,env,headless:true});
  try {
  const data=signed(tokens[platform]!,crypto.randomInt(100_000_000,2_000_000_000)), header=platform==='telegram'?'x-telegram-init-data':'x-max-init-data';
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const captured:{url:string;body:string;headers:Record<string,string>}[]=[], external:string[]=[], errors:string[]=[];
  await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
  await context.addInitScript(({platform,data})=>{const back={show(){},hide(){},onClick(){},offClick(){}};if(platform==='telegram')(window as any).Telegram={WebApp:{initData:data,ready(){},expand(){},BackButton:back}};else (window as any).WebApp={initData:data,BackButton:back};},{platform,data});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().startsWith(base+'/api/')) captured.push({url:r.url(),body:r.postData()??'',headers:r.headers()});});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.getByPlaceholder('Имя или ник').fill('Тест');await page.locator('.age-btn').filter({hasText:new RegExp(`^${age}$`)}).click();
  await page.getByRole('button',{name:'В город!'}).click();await page.getByRole('button',{name:'Начать миссию'}).waitFor();await assertNoHorizontalOverflow(page);
  await page.getByRole('button',{name:'Начать миссию'}).click();await page.getByRole('button',{name:'Как я сейчас?'}).click();await page.getByRole('button',{name:'Радость',exact:true}).click();assert.ok(await page.getByText('Ты отметил: радость', {exact:false}).isVisible());await assertNoHorizontalOverflow(page);
  await page.getByRole('button',{name:'Продолжить →',exact:true}).click();
  const start=await responseFor(page,'start',()=>page.getByRole('button',{name:'Перейти к миссии'}).click());assert.equal(start.step,0);assert.equal(start.storyOffer.length,3);
  const card=start.storyOffer.find((x:any)=>x.id===({6:'day_1_default',9:'day_1_music',12:'day_1_picture'} as Record<number,string>)[age]);assert.ok(card);
  const selection=await responseFor(page,'select_story',()=>page.locator('.story-deck-card').filter({hasText:card.title}).click());assert.equal(selection.item.scenarioId,card.scenarioId);await assertNoHorizontalOverflow(page);
  await page.locator('.options .option').first().click();
  {
   await page.getByRole('button',{name:'Продолжить историю →'}).click();
   assert.ok(await page.getByText('Продолжение · 2 из 2').isVisible());await assertNoHorizontalOverflow(page);
   await page.locator('.story-second-page .option').last().click();
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Начать миссию'}).waitFor();await welcome(page);
   const restoredStory=await responseFor(page,'start',()=>page.getByRole('button',{name:'Перейти к миссии'}).click());assert.equal(restoredStory.step,0);assert.equal(restoredStory.resumed,true);
   await page.getByText('История восстановлена в этой вкладке. Выбор можно изменить.').waitFor();
   assert.equal(await page.locator('.story-second-page .option').last().getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'← К первой части'}).click();
   await page.locator('.options .option').nth(1).click();await page.getByRole('button',{name:'Продолжить историю →'}).click();
   await page.locator('.story-second-page .option').first().click();
  }
  let story:any;
  if(platform==='max') {
   let receipt:any;
   const failAfterCommit=async (route:import('playwright-core').Route)=>{
    if(route.request().method()==='POST' && route.request().postDataJSON()?.action==='answer') {
     const serverResponse=await route.fetch();assert.equal(serverResponse.status(),200);receipt=await serverResponse.json();await route.abort('failed');
    } else await route.continue();
   };
   await page.route(`${base}/api/session`,failAfterCommit);
   await page.getByRole('button',{name:'Завершить историю →'}).click();
   await page.getByRole('button',{name:'Повторить отправку'}).waitFor();await page.unroute(`${base}/api/session`,failAfterCommit);
   story=await responseFor(page,'answer',()=>page.getByRole('button',{name:'Повторить отправку'}).click());assert.deepEqual(story,receipt);
  } else story=await responseFor(page,'answer',()=>page.getByRole('button',{name:'Завершить историю →'}).click());
  assert.equal(story.next.instance.kind,'social-practice');
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Продолжение истории'}).waitFor();
  assert.equal(await dialog.locator('#feedback-text').textContent(),story.feedback);
  const aloud=dialog.getByRole('button',{name:'🔊 Прочитать вслух'});
  if(await aloud.count()) {
   await dialog.getByRole('button',{name:'Дальше →'}).focus();await page.keyboard.press('Shift+Tab');
   assert.equal(await aloud.evaluate(el=>document.activeElement===el),true);
   await page.keyboard.press('Shift+Tab');
   assert.equal(await dialog.getByRole('button',{name:'Дальше →'}).evaluate(el=>document.activeElement===el),true);
  }
  await assertNoHorizontalOverflow(page);
  await page.getByRole('button',{name:'Дальше →'}).click();await page.locator('.support-round-options button').first().click();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Начать миссию'}).waitFor();await welcome(page);
  const resumed=await responseFor(page,'start',()=>page.getByRole('button',{name:'Перейти к миссии'}).click());assert.equal(resumed.resumed,true);assert.equal(resumed.step,1);
  await page.getByText('Твои незавершённые выборы восстановлены в этой вкладке.').waitFor();await assertNoHorizontalOverflow(page);
  let practice:any;
  if(platform==='max') {
   // Continue the restored notebook, review and edit a choice before sending.
   assert.ok(await page.getByText('Ситуация 2 из 3').isVisible());
   await page.locator('.support-round-options button').nth(1).click();
   await page.getByRole('button',{name:'Следующая ситуация →'}).click();
   await page.locator('.support-round-options button').nth(2).click();
   await page.getByRole('button',{name:'Посмотреть все идеи →'}).click();
   await page.getByRole('button',{name:'Изменить идею для ситуации 1'}).click();
   await page.locator('.support-round-options button').nth(2).click();
   await page.getByRole('button',{name:'Посмотреть все идеи →'}).click();await assertNoHorizontalOverflow(page);
   practice=await responseFor(page,'answer',()=>page.getByRole('button',{name:'Готово →',exact:true}).click());
   const answers=captured.filter(r=>r.url.endsWith('/api/session')).map(r=>{try{return JSON.parse(r.body)}catch{return {}}}).filter(r=>r.action==='answer'&&Array.isArray(r.answer?.cells));
   assert.ok(answers.some(r=>JSON.stringify(r.answer.cells)==='[2,1,2]'));
  } else {
   await page.getByRole('button',{name:'Пропустить упражнение'}).click();
   practice=await responseFor(page,'answer',()=>page.getByRole('button',{name:'Да, пропустить'}).click());
  }
  assert.equal(practice.evaluation,'not_scored');
  await page.getByRole('button',{name:'Дальше →'}).click();let item=practice.next;
  for(let step=2;step<start.steps;step++){
   console.log('  task',platform,age,step,item.instance.kind); const result=await responseFor(page,'answer',()=>task(page,item));if(result.done){await page.getByRole('button',{name:'Итоги 🏆'}).click();break;}item=result.next;await page.getByRole('button',{name:'Дальше →'}).click();
  }
  await page.getByText('Миссия выполнена!').waitFor();await page.getByRole('button',{name:'Подвести итог'}).click();await page.getByRole('button',{name:'История',exact:false}).click();await page.getByRole('button',{name:'Домой'}).click();
  const body=captured.map(x=>x.body).join('\n');assert.ok(!/Радость|радость|joy|checkin|reflection/.test(body),'local feelings/reflection must not be sent');
  for(const request of captured){assert.equal(request.headers[header],data);assert.equal(request.headers[platform==='telegram'?'x-max-init-data':'x-telegram-init-data'],undefined);assert.ok(!request.url.includes(data));}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const profileId=await page.evaluate(()=>localStorage.getItem('gib:profileId'));assert.ok(profileId);const deleted=await context.request.delete(`${base}/api/profile?profileId=${encodeURIComponent(profileId)}`,{headers:{[header]:data}});assert.equal(deleted.status(),200);
  console.log(`  ok Chromium synthetic ${platform}, age ${age}: private check-in, story, reload, practice, tasks and reflection`);
  } finally {await browser.close();}
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
