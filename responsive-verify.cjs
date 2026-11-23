const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let playwright;try{playwright=require('playwright')}catch{playwright=require(path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const root='file:///'+__dirname.replaceAll('\\','/')+'/index.html';
const sizes=[[320,480],[320,568],[360,640],[375,667],[390,844],[414,896],[600,800],[768,1024],[820,1180],[844,390],[740,360],[667,375],[960,540],[1024,600],[1280,720],[1366,768],[1440,900],[1920,1080],[2560,1440]];
const overlaps=(a,b)=>a.x<b.x+b.w-1&&a.x+a.w>b.x+1&&a.y<b.y+b.h-1&&a.y+a.h>b.y+1;
async function measure(page){return page.evaluate(()=>{
 const rect=q=>{const el=document.querySelector(q),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,visible:!!r.width&&!!r.height}};
 const state=window.__CITY_PATROL__.snapshot();
 return {width:innerWidth,height:innerHeight,scrollX:document.documentElement.scrollWidth-innerWidth,pageHeight:document.documentElement.scrollHeight,stage:rect('#mapStage'),mini:rect('.world-overview'),scan:rect('#scanHint'),boost:rect('#boostButton'),hud:rect('#mobileHud'),dpad:rect('#touchControls'),nav:rect('nav'),canvas:{w:document.querySelector('#cityCanvas').width,h:document.querySelector('#cityCanvas').height,dpr:Math.min(devicePixelRatio,2)},state};
})}
(async()=>{
 const browser=await playwright.chromium.launch({headless:true,channel:'msedge'}),checks=[],errors=[];
 try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(root);await page.evaluate(()=>document.fonts.ready);await page.locator('#startButton').click();
 const baseline=await measure(page),targets=baseline.state.targets.map(t=>[t.id,t.x,t.y,t.done]);
 for(const [width,height] of sizes){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);
  const m=await measure(page),label=width+'×'+height;
  assert.equal(m.scrollX,0,'horizontal overflow '+label);
  assert.equal(m.state.mode,'running','resize interrupts play '+label);
  assert.equal(m.state.score,0);assert.equal(m.state.caught,0);assert.deepEqual(m.state.drone,baseline.state.drone,'drone moved on resize '+label);
  assert.deepEqual(m.state.targets.map(t=>[t.id,t.x,t.y,t.done]),targets,'events reset on resize '+label);
  assert.equal(m.state.viewport.sx,m.state.viewport.sy,'stretched map '+label);
  assert(Math.abs(m.canvas.w-m.stage.w*m.canvas.dpr)<=1);assert(Math.abs(m.canvas.h-m.stage.h*m.canvas.dpr)<=1);
  assert(m.stage.w>200&&m.stage.h>=190,'unusable map '+label);
  assert(m.stage.x>=0&&m.stage.x+m.stage.w<=width+1);
  if(width>=960){
   assert(m.pageHeight<=height+1,'desktop page exceeds window '+label);
   assert(m.stage.y+m.stage.h<height,'desktop map exceeds window '+label);
   const scan=await page.locator('#scanButton').boundingBox();assert(scan.y>=0&&scan.y+scan.height<=height,'desktop scan action clipped '+label);
  }else{
   for(const q of ['scan','boost','hud','dpad','mini']){
    const b=m[q];assert(b.visible,'missing touch UI '+q+' '+label);
    assert(b.x>=m.stage.x-1&&b.x+b.w<=m.stage.x+m.stage.w+1,'control outside map '+q+' '+label);
    assert(b.y>=m.stage.y-1&&b.y+b.h<=m.nav.y+1,'control hidden by bottom nav '+q+' '+label);
   }
   for(const q of ['scan','boost'])assert(m[q].h>=44,'undersized action '+q+' '+label);
   for(const q of ['scan','boost','hud','dpad','mini'])for(const p of ['scan','boost','hud','dpad','mini'])if(q<p)assert(!overlaps(m[q],m[p]),'controls overlap '+q+'/'+p+' '+label);
   const buttons=await page.locator('[data-dir],#mobilePauseButton').evaluateAll(els=>els.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));assert(buttons.every(b=>b.w>=44&&b.h>=44),'undersized touch target '+label);
  }
  if([[390,844],[844,390],[1366,768],[1920,1080]].some(s=>s[0]===width&&s[1]===height))await page.screenshot({path:path.join(__dirname,'responsive-'+width+'x'+height+'.png')});
  checks.push({size:label,map:{width:Math.round(m.stage.w),height:Math.round(m.stage.h)}});
 }
 assert((await measure(page)).state.remaining<baseline.state.remaining,'resizing reset timer');
 // The browser is resized while a real time-stop dialogue is open.
 await page.setViewportSize({width:390,height:844});await page.keyboard.press('Space');await page.locator('#conversationDialog').waitFor({state:'visible'});
 const frozen=await page.evaluate(()=>window.__CITY_PATROL__.snapshot());
 for(const [width,height] of [[844,390],[320,568],[390,844]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(90);
  const s=await page.evaluate(()=>window.__CITY_PATROL__.snapshot());assert.equal(s.mode,'dialogue');assert.equal(s.remaining,frozen.remaining);assert.equal(s.cityTime,frozen.cityTime);assert.deepEqual(s.drone,frozen.drone);
  const box=await page.locator('#conversationDialog').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
  assert.equal(await page.locator('#conversationDialog').evaluate(el=>el.scrollWidth-el.clientWidth),0,'dialogue horizontal overflow');
 }
 await page.locator('#continueButton').click();assert.equal((await measure(page)).state.caught,1);
 const phone=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));
 await phone.goto(root);await phone.evaluate(()=>document.fonts.ready);await phone.screenshot({path:path.join(__dirname,'mobile.png'),fullPage:true});
 const start=await phone.locator('#mobileStartButton').boundingBox(),nav=await phone.locator('nav').boundingBox();assert(start.y+start.height<nav.y,'phone start is behind navigation');
 await phone.locator('#mobileStartButton').tap();await phone.waitForTimeout(150);
 assert.equal((await measure(phone)).canvas.dpr,2,'high-DPI canvas cap');
 const cdp=await phone.context().newCDPSession(phone),right=await phone.locator('[data-dir="right"]').boundingBox(),before=(await measure(phone)).state;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:right.x+22,y:right.y+22}]});await phone.waitForTimeout(200);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert((await measure(phone)).state.drone.x>before.drone.x+30);
 await phone.setViewportSize({width:844,height:390});await phone.waitForTimeout(150);await phone.locator('#boostButton').tap();assert.equal(await phone.locator('#boostButton').getAttribute('aria-pressed'),'true');await phone.locator('#mobilePauseButton').tap();assert.equal((await measure(phone)).state.mode,'paused');await phone.locator('#resumeButton').tap();
 await phone.locator('#navBook').tap();await phone.locator('[data-close="bookDialog"]').first().tap();assert.equal((await measure(phone)).state.mode,'running');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(__dirname,'responsive-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),browser:'Microsoft Edge / Playwright',sizes:checks,checks:['live resize preserves position, timer, score and all events','desktop game and scan action fit browser height','mobile controls fit above navigation without overlapping','44px touch targets, high-DPI canvas and equal map scales','orientation changes preserve time-stop conversations','real touch movement, landscape boost/pause and handbook work'],errors},null,2));
 console.log('PASS responsive layouts at '+checks.length+' sizes, live resizing, rotation, time-stop dialogs, high-DPI rendering and real touch controls');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
