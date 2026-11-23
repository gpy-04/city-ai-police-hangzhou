const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let playwright;try{playwright=require('playwright')}catch{playwright=require(path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
const root='file:///'+__dirname.replaceAll('\\','/')+'/index.html',checks=[];
const snap=page=>page.evaluate(()=>window.__CITY_PATROL__.snapshot());
function pass(text){checks.push(text);console.log('PASS',text)}
async function miniClick(page,target,touch=false){
 await page.locator('#miniMap').scrollIntoViewIfNeeded();
 const b=await page.locator('#miniMap').boundingBox(),s=await snap(page),x=b.x+target.x/s.world.width*b.width,y=b.y+target.y/s.world.height*b.height;
 if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
}
async function awaitDialogue(page){
 try{await page.locator('#conversationDialog').waitFor({state:'visible',timeout:10000})}catch(e){console.log('FAILED STATE',JSON.stringify(await snap(page)));await page.screenshot({path:path.join(__dirname,'failure.png'),fullPage:true});throw e}
}
(async()=>{
 const browser=await playwright.chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(root);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(550);
 {
 const layout=await page.evaluate(()=>window.__CITY_PATROL__.layout());
 const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 for(const object of [...layout.structures,...layout.amenities]){
  assert(!layout.roads.some(road=>intersects(object,road)),JSON.stringify({message:'object covers road or sidewalk',object}));
  assert(!intersects(object,{x:1470,y:0,w:90,h:708}),JSON.stringify({message:'object covers canal',object}));
 }
 for(let i=0;i<layout.structures.length;i++)for(let j=i+1;j<layout.structures.length;j++){
  assert(!intersects(layout.structures[i],layout.structures[j]),JSON.stringify({message:'buildings overlap',a:layout.structures[i],b:layout.structures[j]}));
 }
 for(const amenity of layout.amenities)for(const building of layout.structures){
  const inside=building.x>=amenity.x&&building.y>=amenity.y&&building.x+building.w<=amenity.x+amenity.w&&building.y+building.h<=amenity.y+amenity.h;
  assert(!intersects(amenity,building)||inside,JSON.stringify({message:'amenity covers existing building',amenity,building}));
 }
 assert(layout.amenities.length>=20);assert(new Set(layout.amenities.map(p=>p.kind)).size>=8);
 pass('all building roofs, shadows and new amenities clear roads, sidewalks and canal; buildings do not overlap; 20+ themed parcels enrich the city');
 }
 let s=await snap(page);assert.deepEqual(s.world,{width:3000,height:2000,area:6000000});assert.equal(s.world.area/(1200*800),6.25);assert(s.camera.w<s.world.width/2);assert(s.camera.h<s.world.height/2);assert.equal(s.targets.length,20);assert.equal(new Set(s.targets.map(t=>t.type)).size,20);assert.equal(s.districts.length,6);assert.equal(s.remaining,60);
 const content=await page.evaluate(()=>Object.values(window.PATROL_CONTENT.events));for(const field of ['title','officer','citizen','fact'])assert.equal(new Set(content.map(t=>t[field])).size,20);
 await page.screenshot({path:path.join(__dirname,'desktop.png'),fullPage:true});
 const image=await page.evaluate(()=>window.__CITY_PATROL__.worldImage());fs.writeFileSync(path.join(__dirname,'world-map.png'),Buffer.from(image.split(',')[1],'base64'));
 pass('actual world is 6.25 times larger, with 6 districts and 20 unique event narratives');
 await page.locator('#navBook').click();assert.equal(await page.locator('.book-entry').count(),20);await page.locator('[data-close="bookDialog"]').last().click();
 await page.locator('#startButton').click();await page.keyboard.press('Space');await awaitDialogue(page);
 let before=await snap(page);await page.waitForTimeout(650);s=await snap(page);assert.equal(s.remaining,before.remaining);assert.equal(s.cityTime,before.cityTime);assert.deepEqual(s.camera,before.camera);
 await page.keyboard.press('Escape');assert.equal((await snap(page)).mode,'dialogue');await page.waitForTimeout(300);await page.screenshot({path:path.join(__dirname,'dialogue.png'),fullPage:true});await page.locator('#continueButton').click();assert.equal((await snap(page)).caught,1);pass('nearby scan freezes timer, world animation and follow camera during dialogue');
 before=await snap(page);await page.keyboard.down('KeyD');await page.keyboard.down('ShiftLeft');await page.waitForTimeout(350);await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyD');s=await snap(page);assert(s.drone.x>before.drone.x+120);assert(s.camera.x>before.camera.x);pass('keyboard acceleration and camera follow use world coordinates');
 await page.keyboard.press('KeyP');before=await snap(page);await page.waitForTimeout(350);s=await snap(page);assert.equal(s.remaining,before.remaining);assert.deepEqual(s.camera,before.camera);await page.keyboard.press('Escape');assert.equal((await snap(page)).mode,'running');
 await page.locator('#navBook').click();before=await snap(page);await page.waitForTimeout(300);assert.equal((await snap(page)).remaining,before.remaining);await page.locator('[data-close="bookDialog"]').last().click();pass('pause, resume and 20-entry handbook preserve time');
 s=await snap(page);const far=s.targets.find(t=>t.x>2400&&t.y>900);before=s;await miniClick(page,far);await page.waitForTimeout(300);s=await snap(page);assert.equal(s.mode,'running');assert(Math.hypot(s.drone.x-before.drone.x,s.drone.y-before.drone.y)>30);assert(Math.hypot(s.drone.x-far.x,s.drone.y-far.y)>500);await awaitDialogue(page);s=await snap(page);assert(s.drone.x>2400);assert(s.camera.x>1200);assert(s.visited.includes('qianjiang'));await page.locator('#continueButton').click();await page.waitForTimeout(350);await page.screenshot({path:path.join(__dirname,'expanded-city.png'),fullPage:true});pass('mini-map navigation flies continuously beyond the old map and discovers Qianjiang');
 const playingHeight=(await snap(page)).viewport.height;
 const uniqueTitles=new Set(),completed=new Set((await snap(page)).targets.filter(t=>t.done).map(t=>t.type));
 while((s=await snap(page)).mode==='running'&&s.caught<20){
  const t=s.targets.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-s.drone.x,a.y-s.drone.y)-Math.hypot(b.x-s.drone.x,b.y-s.drone.y))[0];
  console.log('Checking event',s.caught+1,t.type,t.location);
  await miniClick(page,t);await awaitDialogue(page);
  const title=await page.locator('#conversationTitle').innerText();assert(!uniqueTitles.has(title));uniqueTitles.add(title);assert.match(await page.locator('#citizenText').innerText(),/错|不对/);assert((await page.locator('#knowledgeText').innerText()).length>20);
  const frozen=await snap(page);await page.waitForTimeout(60);assert.equal((await snap(page)).remaining,frozen.remaining);
  assert(!completed.has(t.type));completed.add(t.type);await page.locator('#continueButton').click();
  const after=await snap(page);assert.equal(after.score,completed.size*100);assert(after.targets.find(v=>v.id===t.id).done);
  if(after.caught===18){await page.waitForTimeout(550);assert.equal((await snap(page)).viewport.height,playingHeight,'map must not shift as the nearby list gets shorter')}
 }
 s=await snap(page);assert.equal(s.mode,'finished');assert.equal(s.caught,20);assert.equal(s.score,2000);assert.equal(s.visited.length,6);assert.equal(await page.locator('#resultKnowledge').innerText(),'20');assert.equal(completed.size,20);await page.waitForTimeout(450);await page.screenshot({path:path.join(__dirname,'result.png'),fullPage:true});pass('all 20 different events complete once each, all 6 districts are explored, full score is 2000');
 const oldPositions=s.targets.map(t=>[t.x,t.y]);await page.locator('#playAgainButton').click();s=await snap(page);assert.equal(s.score,0);assert.equal(s.caught,0);assert.equal(s.targets.length,20);assert(s.targets.slice(4).filter((t,i)=>t.x!==oldPositions[i+4][0]||t.y!==oldPositions[i+4][1]).length>3);pass('replay resets progress and reshuffles new event locations');
 await page.keyboard.press('KeyP');await page.clock.install();await page.locator('#restartButton').click();assert.equal((await snap(page)).mode,'running');
 await page.clock.fastForward(61000);await page.locator('#resultDialog').waitFor({state:'visible',timeout:5000});assert.equal((await snap(page)).remaining,0);await page.locator('#finishButton').click();pass('60-second limit still ends the expanded patrol');
 await page.reload();await page.locator('#navRecords').click();assert.match(await page.locator('#recordsContent').innerText(),/2000/);await page.locator('[data-close="recordsDialog"]').last().click();
 await page.evaluate(()=>{const rows=JSON.parse(localStorage.getItem('hangzhou-city-guardian-v1'));rows.push({score:800,count:8,date:new Date().toISOString()});localStorage.setItem('hangzhou-city-guardian-v1',JSON.stringify(rows))});
 await page.reload();await page.locator('#navRecords').click();assert.match(await page.locator('#recordsContent').innerText(),/8 \/ 8/);await page.locator('[data-close="recordsDialog"]').last().click();pass('2000-point results persist and original 8-target journals remain readable');
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(root);await mobile.evaluate(()=>document.fonts.ready);await mobile.waitForTimeout(550);await mobile.screenshot({path:path.join(__dirname,'mobile.png'),fullPage:true});await mobile.locator('#mobileStartButton').tap();await mobile.waitForTimeout(300);
 const cdp=await mobile.context().newCDPSession(mobile),down=await mobile.locator('[data-dir="down"]').boundingBox();before=await snap(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:down.x+down.width/2,y:down.y+down.height/2}]});await mobile.waitForTimeout(1250);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});s=await snap(mobile);assert(s.drone.y>800);assert(s.camera.y>before.camera.y+200);assert(s.visited.includes('zhijiang'));assert(await mobile.locator('#mobileHud').isVisible());
 await mobile.locator('#boostButton').tap();assert.equal(await mobile.locator('#boostButton').getAttribute('aria-pressed'),'true');
 s=await snap(mobile);const near=s.targets.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-s.drone.x,a.y-s.drone.y)-Math.hypot(b.x-s.drone.x,b.y-s.drone.y))[0];await miniClick(mobile,near,true);await awaitDialogue(mobile);await mobile.locator('#continueButton').tap();assert.equal((await snap(mobile)).score,100);await mobile.waitForTimeout(350);await mobile.screenshot({path:path.join(__dirname,'mobile-playing.png'),fullPage:true});pass('real touch controls cross the old boundary; mobile mini-map, boost and dialogue work');
 await mobile.locator('#mobilePauseButton').tap();assert.equal((await snap(mobile)).mode,'paused');await mobile.locator('#resumeButton').tap();await mobile.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await snap(mobile)).mode,'paused');pass('phone pause and automatic focus-loss pause remain functional');
 const layout=await browser.newPage();layout.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,375,390,414,768,1024,1440,1920]){
  await layout.setViewportSize({width,height:1000});await layout.goto(root);await layout.waitForTimeout(70);assert.equal(await layout.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'overflow '+width);s=await snap(layout);assert.equal(s.viewport.sx,s.viewport.sy,'world remains undistorted');
 }
 await layout.emulateMedia({reducedMotion:'reduce'});await layout.goto(root);await layout.locator('#startButton').click();await layout.keyboard.down('KeyD');await layout.waitForTimeout(180);await layout.keyboard.up('KeyD');assert((await snap(layout)).drone.x>535);pass('320–1920px layouts, undistorted map rendering and reduced-motion playability');
 assert.deepEqual(errors,[]);pass('no browser runtime errors');
 fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),browser:'Microsoft Edge / Playwright',world:{width:3000,height:2000,areaMultiplier:6.25,districts:6,eventTypes:20},checks,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
