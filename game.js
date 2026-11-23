(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const svg = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const W = 3000, H = 2000, RANGE = 100, DURATION = 60, SPEED = 420;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compactScreen = matchMedia('(max-width:959px)'), touchScreen = matchMedia('(pointer:coarse)');
  const canvas = $('cityCanvas'), stage = $('mapStage'), ctx = canvas.getContext('2d');
  let g = ctx, sx = 1, sy = 1, dpr = 1, cssW = 1, cssH = 1;
  const camera = {x:0,y:0,w:1200,h:800}, visited = new Set();
  const mini = $('miniMap'), miniCtx = mini.getContext('2d'), miniBackground = document.createElement('canvas');
  let lastNearbyKey = '', boost = false;
  const traffic = window.PATROL_CONTENT.events;
  const missionData = window.PATROL_CONTENT.sites;
  const districts = window.PATROL_CONTENT.districts;
  const eventTypes = Object.keys(traffic);
  let mode = 'ready', remaining = DURATION, score = 0, caught = 0, cityTime = 0;
  let targets = [], activeTarget = null, destination = null, autoTarget = null, last = 0;
  let drone = {x:535,y:410,vx:0,vy:0}, keys = new Set(), particles = [], trail = [], toastTimer;
  let soundEnabled = false, audioContext = null, infoPrevious = null, records = [];
  const storageKey = 'hangzhou-city-guardian-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) records = saved.filter(r => r && Number.isInteger(r.score) && r.score >= 0 && r.score <= eventTypes.length*100 && Number.isInteger(r.count) && r.count >= 0 && r.count <= eventTypes.length && typeof r.date === 'string' && !isNaN(Date.parse(r.date))).slice(0,10).map(r=>({...r,total:Number.isInteger(r.total)&&r.total>0?r.total:8}));
  } catch {}
  function beep(kind='tap') {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const notes = kind === 'done' ? [523,659,784] : kind === 'scan' ? [660,880] : [440];
      notes.forEach((freq,i) => {
        const osc = audioContext.createOscillator(), gain = audioContext.createGain(), start = audioContext.currentTime + i * .095;
        osc.type = 'sine';osc.frequency.value = freq;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.045,start+.012);gain.gain.exponentialRampToValueAtTime(.001,start+.17);
        osc.connect(gain);gain.connect(audioContext.destination);osc.start(start);osc.stop(start+.18);
      });
    } catch {}
  }
  function toast(text) { clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600); }
  function reset() {
    const shuffled=missionData.slice(4);
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}
    targets=eventTypes.map((type,id)=>({...((id<4)?missionData[id]:shuffled[id-4]),type,id,done:false}));
    visited.clear();visited.add('westlake');lastNearbyKey='';boost=false;
    remaining=DURATION;score=0;caught=0;cityTime=0;activeTarget=null;destination=null;autoTarget=null;particles=[];trail=[];keys.clear();drone={x:535,y:410,vx:0,vy:0};mode='ready';
    if(cssW>1)followCamera(1,true);
    $('toast').classList.remove('visible');clearTimeout(toastTimer);updateUI();updateNearby();
  }
  function updateUI() {
    document.body.dataset.patrolActive=String(mode!=='ready');
    $('timeValue').textContent=String(Math.ceil(remaining)).padStart(2,'0');
    $('timeBar').style.transform='scaleX('+Math.max(0,remaining/DURATION)+')';
    document.querySelector('.time-track').classList.toggle('urgent',remaining<=10);
    document.querySelector('.time-number').classList.toggle('urgent',remaining<=10);
    $('scoreValue').innerHTML=String(score).padStart(3,'0')+'<span>分</span>';
    $('caughtValue').textContent=caught;$('totalValue').textContent='/ '+targets.length+' 起';
    const ready=mode==='ready', running=mode==='running';
    $('readyNote').hidden=!ready;$('startButton').hidden=!ready;$('scanButton').hidden=ready||mode==='finished';$('touchControls').hidden=!running;$('scanHint').hidden=!running;$('pauseButton').disabled=!running;$('scanButton').disabled=!running;$('mobileHud').hidden=!running;$('mobileScore').textContent=score;
    $('timeDescription').textContent=mode==='dialogue'?'科普时停 · 时间已暂停':mode==='paused'||mode==='info'?'暂时休息 · 计时已暂停':'本次巡逻剩余';
    $('mapStatus').textContent=ready?'无人机待命':running?'小杭巡逻中':mode==='dialogue'?'文明对话 · 时停中':mode==='finished'?'本次巡逻已完成':'巡逻已暂停';
    document.querySelectorAll('[data-group]').forEach(el=>{const group=el.dataset.group,all=targets.filter(t=>traffic[t.type].group===group),n=all.filter(t=>t.done).length;el.textContent=n+'/'+all.length;el.classList.toggle('completed',n===all.length)});
    $('exploredCount').textContent=visited.size+'/6';
    $('boostButton').classList.toggle('is-boosting',boost||keys.has('boost'));
    $('boostButton').setAttribute('aria-pressed',String(boost||keys.has('boost')));
    $('boostButton').hidden=!running;
    const district=districts.find(d=>drone.x>=d.x&&drone.x<d.x+d.w&&drone.y>=d.y&&drone.y<d.y+d.h);
    if(district)$('currentDistrict').textContent='杭州 · '+district.name;
  }
  function start() {
    reset();mode='running';last=performance.now();updateUI();beep();canvas.focus({preventScroll:true});toast(compactScreen.matches||touchScreen.matches?'20 类不同事件 · 小地图导航 · 点按加速':'20 类不同事件 · 点击小地图探索六片街区 · Shift 加速');
    if (compactScreen.matches) window.scrollTo({top:0,behavior:'instant'});
  }
  function nearest() {
    return targets.filter(t=>!t.done).map(t=>({t,d:Math.hypot(t.x-drone.x,t.y-drone.y)})).sort((a,b)=>a.d-b.d)[0];
  }
  function scan(target) {
    if(mode!=='running')return;
    const near=target?{t:target,d:Math.hypot(target.x-drone.x,target.y-drone.y)}:nearest();
    if(!near||near.t.done){toast('这里已经恢复文明啦，去看看其他街区吧');return}
    if(near.d>RANGE){toast('还差一点，靠近橙色标记再扫描');beep();return}
    activeTarget=near.t;mode='dialogue';destination=null;autoTarget=null;keys.clear();boost=false;drone.vx=0;drone.vy=0;
    const data=traffic[activeTarget.type];
    $('conversationLocation').textContent=activeTarget.location;
    $('conversationTitle').textContent=data.title;$('officerText').textContent=data.officer;$('citizenText').textContent=data.citizen;$('citizenName').textContent=data.person;
    $('knowledgeText').textContent=data.fact;$('knowledgeSource').textContent=data.source;
    $('citizenAvatar').innerHTML='<svg viewBox="0 0 44 44" aria-hidden="true"><path d="M8 44c0-13 28-13 28 0" fill="#b2b999"/><circle cx="22" cy="20" r="11" fill="#e3bb96"/><path d="M11 20C7 2 38 3 33 21l-5-9-4 5-12 1" fill="#695d4e"/><circle cx="18" cy="21" r="1" fill="#665f50"/><circle cx="26" cy="21" r="1" fill="#665f50"/><path d="M19 26q3 3 6 0" stroke="#aa7d5f" stroke-width="1.5" fill="none"/></svg>';
    updateUI();beep('scan');$('conversationDialog').showModal();
  }
  function resolveTarget() {
    if(mode!=='dialogue'||!activeTarget||activeTarget.done)return;
    activeTarget.done=true;score+=100;caught++;
    for(let i=0;i<16;i++)particles.push({x:activeTarget.x,y:activeTarget.y,vx:Math.cos(i/16*Math.PI*2)*50,vy:Math.sin(i/16*Math.PI*2)*50-20,life:1});
    $('conversationDialog').close();activeTarget=null;mode='running';last=performance.now();updateUI();beep('done');toast('+100 文明积分 · 谢谢你，让城市更美好');
    if(caught===targets.length)finish();else canvas.focus({preventScroll:true});
  }
  function finish() {
    if(mode==='finished')return;
    mode='finished';keys.clear();destination=null;autoTarget=null;drone.vx=0;drone.vy=0;
    const learned=[...new Set(targets.filter(t=>t.done).map(t=>t.type))];
    const title=patrolTitle(caught,targets.length);
    $('resultTag').textContent=title;
    $('resultTitle').textContent=caught===targets.length?'全城文明达成，小杭为你点赞！':caught?'因为你，杭州又文明了一点。':'下一次，一起让文明发生。';
    $('resultDescription').textContent=(caught===targets.length?targets.length+' 起不同事件全部完成，还剩 '+Math.ceil(remaining)+' 秒。':'60 秒巡逻结束，成功劝导 '+caught+' / '+targets.length+' 起。')+' 探索了 '+visited.size+' / 6 片街区。';
    $('resultScore').textContent=score;$('resultCount').textContent=caught;$('resultKnowledge').textContent=learned.length;
    $('resultLearned').innerHTML=learned.map(k=>'<span>✓ '+traffic[k].short+'</span>').join('');
    $('resultMessage').textContent=caught?'把今天学会的安全小习惯，也带进真实的每一天吧。':'试试点击橙色感叹号，小杭会自动飞过去。阅读对话时，时间会为你停留。';
    records.unshift({score,count:caught,total:targets.length,explored:visited.size,date:new Date().toISOString(),title});records=records.slice(0,10);
    try{localStorage.setItem(storageKey,JSON.stringify(records))}catch{toast('当前浏览器暂时无法保存档案，本次巡逻仍然有效')}
    updateUI();beep('done');$('resultDialog').showModal();
  }
  function patrolTitle(count,total){return count===total?'满分城市守护者':count>=Math.ceil(total*.6)?'城市文明守护者':count>0?'暖心文明引导员':'未来城市守护者'}
  function pause() {if(mode!=='running')return;mode='paused';keys.clear();boost=false;drone.vx=0;drone.vy=0;updateUI();$('pauseDialog').showModal()}
  function resume() {if(mode!=='paused')return;$('pauseDialog').close();mode='running';last=performance.now();updateUI();canvas.focus({preventScroll:true})}
  function openInfo(id) {
    if(document.querySelector('dialog[open]'))return;
    infoPrevious=mode;if(mode==='running'){mode='info';keys.clear();boost=false;drone.vx=0;drone.vy=0}
    if(id==='recordsDialog')renderRecords();updateUI();$(id).showModal();beep();
  }
  function closeInfo(id) {$(id).close();if(mode==='info'){mode=infoPrevious||'running';last=performance.now()}infoPrevious=null;updateUI()}
  function renderRecords() {
    if(!records.length){$('recordsContent').innerHTML='<div class="empty-records">'+svg('medal')+'<h3>第一份巡逻档案，等你写下。</h3><p>完成一次巡逻，就能在这里留下守护足迹。</p></div>';return}
    const best=Math.max(...records.map(r=>r.score));
    $('recordsContent').innerHTML='<div class="record-best"><span>最近巡逻中的最佳积分</span><strong>'+best+'</strong></div>'+records.map((r,i)=>'<div class="record-item">'+svg('medal')+'<div><strong>'+patrolTitle(r.count,r.total)+'</strong><small>'+new Date(r.date).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' · 成功劝导 '+r.count+' / '+r.total+' 起'+(i===0?' · 最近一次':'')+'</small></div><b>'+r.score+'</b></div>').join('');
  }
  $('bookEntries').innerHTML=Object.values(traffic).map(t=>'<div class="book-entry"><span class="type-icon '+t.color+'">'+svg(t.icon)+'</span><div><strong>'+t.name+'</strong><p>'+t.fact+'</p><small>'+t.source+'</small></div></div>').join('');
  $('startButton').onclick=start;$('mobileStartButton').onclick=start;$('scanButton').onclick=()=>scan();$('scanHint').onclick=()=>scan();$('continueButton').onclick=resolveTarget;$('mobilePauseButton').onclick=pause;
  $('pauseButton').onclick=pause;$('resumeButton').onclick=resume;
  $('restartButton').onclick=()=>{$('pauseDialog').close();start()};
  $('playAgainButton').onclick=()=>{$('resultDialog').close();start()};
  $('finishButton').onclick=()=>{$('resultDialog').close();reset()};
  $('navPatrol').onclick=()=>{canvas.focus({preventScroll:true});if(compactScreen.matches)window.scrollTo({top:0,behavior:reduced?'instant':'smooth'});else $('mapStage').scrollIntoView({behavior:reduced?'instant':'smooth',block:'nearest'})};
  $('navBook').onclick=()=>openInfo('bookDialog');$('navRecords').onclick=()=>openInfo('recordsDialog');$('helpButton').onclick=()=>openInfo('helpDialog');
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeInfo(b.dataset.close));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('cancel',e=>{e.preventDefault();if(d.id==='pauseDialog')resume();else if(['helpDialog','bookDialog','recordsDialog'].includes(d.id))closeInfo(d.id);else if(d.id==='resultDialog'){$('resultDialog').close();reset()}}));
  $('soundButton').onclick=()=>{soundEnabled=!soundEnabled;$('soundButton').innerHTML=svg(soundEnabled?'sound':'mute');$('soundButton').setAttribute('aria-pressed',soundEnabled);$('soundButton').setAttribute('aria-label',soundEnabled?'关闭音效':'开启音效');$('soundButton').title=soundEnabled?'关闭音效':'开启音效';beep()};
  const movement={KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
  document.addEventListener('keydown',e=>{
    if(mode==='running' && (movement[e.code]||['Space','KeyP','Escape','ShiftLeft','ShiftRight'].includes(e.code))){
      if(e.code==='Space'&&document.activeElement?.tagName==='BUTTON')return;
      e.preventDefault();if(movement[e.code]){keys.add(movement[e.code]);destination=null;autoTarget=null}
      if(e.code==='Space'&&!e.repeat)scan();
      if(['KeyP','Escape'].includes(e.code)&&!e.repeat)pause();
      if(e.code==='ShiftLeft'||e.code==='ShiftRight')keys.add('boost');
    }
  });
  document.addEventListener('keyup',e=>{if(movement[e.code])keys.delete(movement[e.code]);if(e.code==='ShiftLeft'||e.code==='ShiftRight')keys.delete('boost')});
  window.addEventListener('blur',()=>{keys.clear();pause()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pause()}});
  document.querySelectorAll('[data-dir]').forEach(b=>{
    b.addEventListener('pointerdown',e=>{if(mode!=='running')return;e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.dir);destination=null;autoTarget=null});
    ['pointerup','pointercancel','lostpointercapture'].forEach(name=>b.addEventListener(name,()=>keys.delete(b.dataset.dir)));
  });
  canvas.addEventListener('pointerdown',e=>{
    if(mode==='ready'){toast('先点击「开始巡逻」，再和小杭一起出发吧');return}if(mode!=='running')return;
    const box=canvas.getBoundingClientRect(),p={x:camera.x+(e.clientX-box.left)/sx,y:camera.y+(e.clientY-box.top)/sy};
    const hit=targets.filter(t=>!t.done).map(t=>({t,d:Math.min(Math.hypot((p.x-t.x)*sx,(p.y-t.y+36)*sy),Math.hypot((p.x-t.x)*sx,(p.y-t.y)*sy))})).sort((a,b)=>a.d-b.d)[0];
    destination={x:Math.max(25,Math.min(W-25,p.x)),y:Math.max(25,Math.min(H-25,p.y))};autoTarget=null;
    if(hit&&hit.d<26){autoTarget=hit.t;destination={x:hit.t.x,y:hit.t.y};if(Math.hypot(drone.x-hit.t.x,drone.y-hit.t.y)<RANGE)scan(hit.t)}
    canvas.focus({preventScroll:true});
  });
  function navigateTo(target){
    if(mode!=='running'){toast('先开始巡逻，再选择你想探索的事件');return}
    if(!target||target.done)return;
    keys.clear();autoTarget=target;destination={x:target.x,y:target.y};
    toast('飞往'+target.location+' · '+traffic[target.type].name);
    if(Math.hypot(drone.x-target.x,drone.y-target.y)<RANGE)scan(target);
    canvas.focus({preventScroll:true});
  }
  $('nearbyList').onclick=e=>{const button=e.target.closest('[data-event]');if(button)navigateTo(targets.find(t=>t.id===Number(button.dataset.event)))};
  $('boostButton').onclick=()=>{if(mode!=='running')return;boost=!boost;$('boostButton').setAttribute('aria-pressed',String(boost));$('boostButton').classList.toggle('is-boosting',boost);canvas.focus({preventScroll:true})};
  mini.addEventListener('pointerdown',e=>{
    e.preventDefault();if(mode!=='running'){toast('开始巡逻后，点击小地图探索整座城');return}
    const box=mini.getBoundingClientRect(),p={x:(e.clientX-box.left)/box.width*W,y:(e.clientY-box.top)/box.height*H};
    const candidate=targets.filter(t=>!t.done).map(t=>({t,d:Math.hypot((t.x-p.x)/W*box.width,(t.y-p.y)/H*box.height)})).sort((a,b)=>a.d-b.d)[0];
    if(candidate&&candidate.d<10)navigateTo(candidate.t);
    else{keys.clear();autoTarget=null;destination={x:Math.max(28,Math.min(W-28,p.x)),y:Math.max(46,Math.min(H-40,p.y))};canvas.focus({preventScroll:true})}
  });
  mini.addEventListener('keydown',e=>{
    if(mode!=='running')return;
    if(e.code==='Enter'||e.code==='Space'){e.preventDefault();const next=nearest();if(next)navigateTo(next.t)}
  });
  function updateNearby(){
    const close=targets.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-drone.x,a.y-drone.y)-Math.hypot(b.x-drone.x,b.y-drone.y)).slice(0,3);
    const key=close.map(t=>t.id).join(',');if(key===lastNearbyKey)return;lastNearbyKey=key;
    $('nearbyList').innerHTML=close.map(t=>'<button class="nearby-event" data-event="'+t.id+'"><span class="type-icon '+traffic[t.type].color+'">'+svg(traffic[t.type].icon)+'</span><span><strong>'+traffic[t.type].name+'</strong><small>'+t.location+'</small></span>'+svg('arrow')+'</button>').join('')||'<p class="all-resolved">全城事件已完成 ✓</p>';
  }
  function followCamera(dt,immediate=false){
    const targetX=Math.max(0,Math.min(W-camera.w,drone.x-camera.w*.5+drone.vx*.12));
    const targetY=Math.max(0,Math.min(H-camera.h,drone.y-camera.h*.5+drone.vy*.12));
    const response=immediate?1:1-Math.exp(-6*dt);
    camera.x+=(targetX-camera.x)*response;camera.y+=(targetY-camera.y)*response;
    camera.x=Math.max(0,Math.min(W-camera.w,camera.x));camera.y=Math.max(0,Math.min(H-camera.h,camera.y));
  }
  function drawMiniMap(){
    const box=mini.getBoundingClientRect(),mw=box.width,mh=box.height;if(!mw||!mh)return;
    miniCtx.setTransform(dpr,0,0,dpr,0,0);miniCtx.clearRect(0,0,mw,mh);miniCtx.drawImage(miniBackground,0,0,mw,mh);
    districts.forEach(d=>{
      miniCtx.fillStyle=visited.has(d.id)?'#4e7f5b':'#869677';miniCtx.font='7.5px "Microsoft YaHei",sans-serif';miniCtx.textAlign='center';
      miniCtx.fillText(d.name,(d.x+d.w*.5)/W*mw,(d.y+d.h*.5)/H*mh+3);
    });
    targets.forEach(t=>{miniCtx.beginPath();miniCtx.arc(t.x/W*mw,t.y/H*mh,t.done?1.5:2.7,0,Math.PI*2);miniCtx.fillStyle=t.done?'#8fac7f':'#e89561';miniCtx.fill()});
    miniCtx.fillStyle='#087e7014';miniCtx.fillRect(camera.x/W*mw,camera.y/H*mh,camera.w/W*mw,camera.h/H*mh);miniCtx.strokeStyle='#087e70';miniCtx.lineWidth=1.2;miniCtx.strokeRect(camera.x/W*mw+.6,camera.y/H*mh+.6,camera.w/W*mw-1.2,camera.h/H*mh-1.2);
    miniCtx.beginPath();miniCtx.arc(drone.x/W*mw,drone.y/H*mh,3.7,0,Math.PI*2);miniCtx.fillStyle='#087e70';miniCtx.fill();miniCtx.strokeStyle='#fff';miniCtx.lineWidth=1;miniCtx.stroke();
  }

  // Every object is drawn in a single flat 2D world. Background art is cached.
  const roadAreas = [
    ...[440,750,1040].map(x=>({x:x-45,y:82,w:90,h:653})),
    ...[245,525].map(y=>({x:363,y:y-44,w:837,h:88})),
    {x:371,y:696,w:682,h:53},
    ...[440,750,1040,1320,1740,2040,2340,2740].map(x=>({x:x-45,y:x<1200?740:86,w:90,h:1950-(x<1200?740:86)})),
    ...[245,525].map(y=>({x:1200,y:y-44,w:1776,h:88})),
    {x:1040,y:686,w:1936,h:88},
    ...[1030,1470,1750].map(y=>({x:24,y:y-44,w:2952,h:88}))
  ];
  const cityStructures=[],cityAmenities=[];
  const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const clearOfRoads=box=>!roadAreas.some(road=>overlaps(box,road));
  function structure(kind,x,y,w,h){cityStructures.push({kind,x,y,w,h})}
  function rounded(x,y,w,h,r,color){g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=color;g.fill()}
  function ellipse(x,y,rx,ry,color){g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fillStyle=color;g.fill()}
  function line(x1,y1,x2,y2,color,width=1){g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.strokeStyle=color;g.lineWidth=width;g.stroke()}
  function label(text,x,y,size=13,color='#70846c',weight=500){g.fillStyle=color;g.font=weight+' '+size+'px "Microsoft YaHei",sans-serif';g.textAlign='center';g.fillText(text,x,y)}
  function path(points,color){g.beginPath();g.moveTo(...points[0]);points.slice(1).forEach(p=>g.lineTo(...p));g.closePath();g.fillStyle=color;g.fill()}
  function tree(x,y,r=15,shade=0){
    ellipse(x+5,y+8,r*.92,r*.63,'#66815b15');line(x,y+8,x,y+20,'#a8ad86',3);
    const colors=['#a2bd8b','#91b48a','#b3c697','#8bae86'];
    ellipse(x-6,y+2,r*.64,r*.7,colors[shade%4]);ellipse(x+5,y+1,r*.76,r*.78,colors[(shade+1)%4]);ellipse(x,y-7,r*.75,r*.78,colors[shade%4]);ellipse(x-4,y-9,r*.35,r*.36,'#ffffff19');
  }
  function bush(x,y,w=35){rounded(x+3,y+4,w,13,6,'#5f80551a');rounded(x,y,w,13,6,'#b2c99d');line(x+6,y+5,x+w-6,y+5,'#c8d8b6',2)}
  function building(x,y,w,h,color='#d1dcca',roof='#e8eddf',style=0){
    structure('building',x-1,y-4,w+8,h+14);
    rounded(x+7,y+10,w,h,5,'#6e816119');rounded(x,y,w,h,5,color);rounded(x-1,y-4,w-2,h-7,4,roof);
    line(x+3,y+h-10,x+w-8,y+h-10,'#ffffffaa',2);line(x+w-4,y+3,x+w-4,y+h-12,'#81967b33',3);
    rounded(x+8,y+6,w-20,h-27,2,color);
    if(style===1){for(let xx=x+13;xx<x+w-13;xx+=12)line(xx,y+11,xx,y+h-29,'#f8faf1',4)}
    else if(style===2){rounded(x+13,y+11,w-31,h-38,3,'#9fb5ae');for(let xx=x+18;xx<x+w-20;xx+=10)line(xx,y+13,xx,y+h-30,'#c4d5c7',1)}
    else {for(let xx=x+14;xx<x+w-18;xx+=18)for(let yy=y+13;yy<y+h-27;yy+=16)rounded(xx,yy,8,6,1,'#f5f6eb')}
    rounded(x+w/2-8,y+h-12,16,8,1,'#95ac9c');
  }
  function traditional(x,y,w=58,h=41){
    structure('courtyard-house',x-5,y-7,w+11,h+14);
    rounded(x+6,y+7,w,h,3,'#6e81611a');rounded(x+4,y+3,w-8,h-3,2,'#e9e6d4');
    path([[x-5,y+8],[x+w/2,y-7],[x+w+5,y+8],[x+w-2,y+16],[x+2,y+16]],'#889b8b');
    path([[x-5,y+8],[x+w/2,y-7],[x+w/2,y+4],[x+2,y+16]],'#a6b2a0');
    for(let i=8;i<w;i+=9)line(x+i,y+10-i*.1,x+i,y+15,'#b8c2ae',1);
    rounded(x+w/2-6,y+h-13,12,13,1,'#b2b7a1');
  }
  function crosswalk(x,y,vertical=false){
    g.save();g.translate(x,y);if(vertical)g.rotate(Math.PI/2);for(let i=-30;i<=30;i+=12)rounded(i,-29,7,58,1,'#fbfcf4');g.restore();
  }
  function signal(x,y){rounded(x,y,9,24,4,'#819487');ellipse(x+4.5,y+6,2,2,'#9da894');ellipse(x+4.5,y+17,2.5,2.5,'#a5d2ac');line(x+4.5,y+24,x+4.5,y+30,'#819487',2)}
  function bench(x,y,angle=0){g.save();g.translate(x,y);g.rotate(angle);rounded(-13,-4,26,9,2,'#baa98c');line(-11,-1,11,-1,'#e6d9b9',1);line(-9,6,-9,9,'#82947d',2);line(9,6,9,9,'#82947d',2);g.restore()}
  function pagoda(x,y){
    ellipse(x+5,y+14,54,21,'#718b5f18');ellipse(x,y+8,48,18,'#d8d9b3');
    rounded(x-21,y-75,42,84,4,'#c5b38b');rounded(x-14,y-75,28,84,2,'#e1cb9a');
    for(let i=0;i<5;i++){const yy=y-i*18;const ww=45-i*5;path([[x-ww,yy],[x-ww+10,yy-6],[x,yy-13],[x+ww-10,yy-6],[x+ww,yy],[x+ww-4,yy+5],[x-ww+4,yy+5]],'#a59470');line(x-ww+6,yy+1,x+ww-6,yy+1,'#e6d7ad',2);if(i<4){rounded(x-7,yy-14,5,8,1,'#8f8b65');rounded(x+3,yy-14,5,8,1,'#8f8b65')}}
    path([[x-20,y-85],[x,y-108],[x+20,y-85]],'#9e916d');line(x,y-106,x,y-118,'#918767',2);
    label('雷 峰 塔',x,y+46,13,'#899469');label('LEIFENG PAGODA',x,y+62,7,'#a5ae8c');
  }
  const staticLayer=document.createElement('canvas');staticLayer.width=W;staticLayer.height=H;
  function makeCity(){
    g=staticLayer.getContext('2d');g.fillStyle='#e5eddc';g.fillRect(0,0,W,H);
    // Park ground, river, and the irregular West Lake shoreline.
    rounded(18,90,360,650,100,'#dbe8ce');rounded(475,80,225,118,20,'#dce7d3');rounded(799,76,198,117,17,'#dee6d4');
    g.beginPath();g.moveTo(1190,620);g.bezierCurveTo(1040,698,995,735,814,746);g.bezierCurveTo(620,768,478,746,350,798);g.lineTo(1200,800);g.closePath();g.fillStyle='#c4ded0';g.fill();
    g.beginPath();g.moveTo(1200,631);g.bezierCurveTo(1050,711,960,751,820,756);g.bezierCurveTo(610,780,500,752,390,800);g.strokeStyle='#b0cbb9';g.lineWidth=2;g.stroke();
    g.beginPath();g.moveTo(100,173);g.bezierCurveTo(164,108,268,128,310,207);g.bezierCurveTo(352,280,307,308,332,367);g.bezierCurveTo(361,441,305,524,253,554);g.bezierCurveTo(178,598,76,551,53,484);g.bezierCurveTo(24,414,71,376,59,314);g.bezierCurveTo(43,247,57,204,100,173);g.closePath();g.fillStyle='#e9ead3';g.fill();g.strokeStyle='#c8d4b6';g.lineWidth=18;g.stroke();g.strokeStyle='#f2edd8';g.lineWidth=10;g.stroke();g.fillStyle='#bad7c8';g.fill();
    g.beginPath();g.moveTo(117,186);g.bezierCurveTo(176,151,265,159,286,208);g.strokeStyle='#d2e5d4';g.lineWidth=2;g.stroke();
    [[123,302],[189,432],[269,280],[94,449],[243,490],[152,214]].forEach(([x,y])=>{ellipse(x,y,17,4,'#e1edde66');ellipse(x+7,y+13,9,2,'#dfecdf55')});
    // Su Causeway, islands and the Broken Bridge.
    path([[132,172],[144,174],[231,548],[218,551]],'#dfe5c6');line(138,175,224,548,'#f8f2dc',5);
    ellipse(242,375,38,24,'#a8c59e');ellipse(233,370,23,13,'#c4d7b0');tree(248,365,10,0);traditional(222,374,27,20);
    ellipse(104,455,23,16,'#bad0a4');tree(103,451,11,2);
    g.save();g.translate(271,198);g.rotate(-.38);rounded(-43,-10,86,20,5,'#ede9d5');line(-41,-7,41,-7,'#adb69b',2);line(-41,7,41,7,'#adb69b',2);for(let x=-37;x<40;x+=12)line(x,-10,x,-5,'#a0b098',2);g.restore();
    label('断 桥',302,177,11,'#849776');label('西  湖',208,312,31,'#65988a',400);label('WEST LAKE',207,334,10,'#84ad9b',400);
    // Small canal in the north-east quarter.
    rounded(1095,-20,54,294,20,'#b8d5c4');line(1092,0,1092,286,'#d3ddbe',7);line(1152,0,1152,286,'#d2dfbf',7);
    rounded(1080,193,83,31,3,'#e6e7cf');for(let x=1085;x<1160;x+=9)line(x,197,x,219,'#c0c8ab',2);
    label('京杭大运河',1122,308,11,'#8ca583');
    // Roads have clear sidewalks and road paint.
    const road='#d9dfd4', edge='#f8f7ec';
    [440,750,1040].forEach(x=>{rounded(x-45,86,90,645,13,edge);rounded(x-35,82,70,653,4,road)});
    [245,525].forEach(y=>{rounded(363,y-44,837,88,12,edge);rounded(363,y-34,837,68,3,road)});
    rounded(371,696,682,53,10,'#f1efdc');rounded(386,704,651,36,5,road);
    g.setLineDash([12,13]);[440,750,1040].forEach(x=>line(x,90,x,733,'#fbfcf4',2));[245,525].forEach(y=>line(369,y,1200,y,'#fbfcf4',2));g.setLineDash([]);
    [440,750,1040].forEach(x=>[245,525].forEach(y=>{rounded(x-35,y-34,70,68,2,road);crosswalk(x-62,y);crosswalk(x+62,y);crosswalk(x,y-58,true);crosswalk(x,y+58,true);signal(x-52,y-56);signal(x+42,y+36)}));
    crosswalk(620,245);signal(606,193);crosswalk(972,525);signal(956,472);crosswalk(750,415,true);crosswalk(1040,648,true);
    // Cycle lanes with directional arrows.
    [440,1040].forEach(x=>{for(let y=126;y<690;y+=100){if(Math.abs(y-245)<65||Math.abs(y-525)<65)continue;line(x+26,y+7,x+26,y-9,'#b3c1a8',2);line(x+26,y-9,x+22,y-4,'#b3c1a8',2);line(x+26,y-9,x+30,y-4,'#b3c1a8',2)}});
    // Homes, commercial roofs, plazas and courtyards.
    building(510,102,73,73,'#b9cbbd','#e6eddf',0);building(606,103,63,73,'#cfceba','#f0ecda',1);
    label('湖滨里',588,195,12,'#8c9b81');
    building(803,104,82,70,'#c8d4c7','#e9eddf',2);building(897,105,78,67,'#cfbda1','#efdfc1',1);
    label('武 林 广 场',884,191,13,'#8f9c80');
    rounded(492,307,194,165,12,'#d8e4cd');rounded(507,323,165,134,8,'#e5e9d5');
    traditional(512,325,64,48);traditional(598,325,57,48);traditional(512,402,62,38);traditional(599,400,57,40);
    rounded(573,357,17,48,3,'#c9d8b9');tree(584,396,14,0);label('湖滨老街',589,486,13,'#899b7d');
    rounded(794,308,197,167,14,'#dce8d1');
    building(812,320,149,65,'#a9c3b7','#e6eee1',2);rounded(827,391,116,55,5,'#c9dbbe');rounded(837,402,96,32,4,'#dce6cd');
    ellipse(883,418,13,13,'#a9c4ac');ellipse(883,418,8,8,'#c2dcd0');bench(836,460);bench(942,460);label('城市书房',886,486,13,'#7f9977');
    building(1091,343,79,97,'#c6cfb8','#ecebd8',1);label('市民中心',1128,470,12,'#8a9a7d');
    // South-side school campus and Qianjiang landmark plaza.
    rounded(488,584,198,100,12,'#d3e1c4');building(507,592,65,66,'#b6cbbb','#e4ead6',0);rounded(591,595,73,68,4,'#b0c69c');g.strokeStyle='#dce6c8';g.lineWidth=2;g.strokeRect(597,601,61,56);line(597,629,658,629,'#dce6c8',2);g.beginPath();g.arc(628,629,10,0,Math.PI*2);g.stroke();label('文明小学',581,689,11,'#879c76');
    rounded(794,580,197,112,14,'#e5e5c9');rounded(802,588,180,97,11,'#eae8d0');
    ellipse(856,636,38,32,'#d4c9a3');ellipse(852,628,36,29,'#c9b98c');ellipse(846,620,25,21,'#e2d0a1');for(let a=-1.2;a<1.3;a+=.25)line(851,601,850+Math.sin(a)*33,629+Math.cos(a)*24,'#b8a77d',1);
    g.save();g.translate(943,628);g.rotate(-.15);rounded(-23,-37,46,74,11,'#b3c4b1');rounded(-18,-38,36,62,10,'#d3ded0');for(let x=-12;x<16;x+=6)line(x,-30,x,15,'#b1c3af',2);g.restore();
    label('湖 滨 文 化 广 场',895,709,14,'#829375');label('HUBIN CULTURE SQUARE',895,726,7,'#9aab8b');
    traditional(1091,576,75,50);building(1194,589,64,70,'#c9d4c0','#e7ecdb',1);
    // Parking bays, bicycles and urban details.
    for(let i=0;i<4;i++){g.strokeStyle='#f9fbef';g.lineWidth=2;g.strokeRect(507+i*37,280,29,18)}
    for(let i=0;i<4;i++){g.strokeStyle='#c0cbb3';g.lineWidth=2;g.beginPath();g.arc(791+i*14,468,4,0,Math.PI*2);g.stroke()}
    bench(351,339,Math.PI/2);bench(351,456,Math.PI/2);
    rounded(355,314,9,21,2,'#b0be98');rounded(355,432,9,21,2,'#b0be98');
    // Park trees follow the lakeside path; road trees frame the blocks.
    [[75,157],[119,123],[162,117],[215,120],[346,177],[362,240],[358,310],[359,399],[359,480],[311,560],[273,580],[133,570],[71,541],[33,486],[30,386],[34,236],[63,606],[89,665],[141,688],[297,683],[346,632],[325,705]].forEach(([x,y],i)=>tree(x,y,13+(i%3)*3,i));
    [[492,107],[492,171],[692,113],[692,174],[786,99],[985,99],[787,177],[989,177],[492,322],[492,454],[692,323],[695,455],[788,323],[989,323],[786,456],[987,455],[490,596],[689,597],[688,670],[787,591],[990,593],[1079,361],[1180,363],[1079,458],[1180,454],[1080,608],[1181,609],[1181,695]].forEach(([x,y],i)=>tree(x,y,10+i%3,i));
    [[524,83],[620,83],[810,83],[930,83],[513,466],[628,466],[817,302],[926,302],[528,572],[623,572],[807,570],[928,570],[1110,328]].forEach(([x,y])=>bush(x,y));
    for(let i=0;i<7;i++){tree(96+i*18,603+(i%2)*13,12,i);tree(112+i*18,650+(i%2)*8,11,i+1)}
    pagoda(246,653);label('柳 浪 闻 莺',131,715,13,'#8c9e7a');
    label('湖 滨 路',391,382,12,'#a0ad94');label('南 山 路',651,555,10,'#9dab96');label('文 明 路',894,220,10,'#a0ad94');
    label('湖 滨 水 岸',634,792,18,'#8fb3a1',400);
    // Tiny lotus leaves, warm paving stones, and shore plants.
    [[82,360],[91,371],[79,382],[303,415],[297,429]].forEach(([x,y])=>{ellipse(x,y,6,3,'#a0c1a4');ellipse(x+7,y-5,3,2,'#e5d3be')});
    for(let i=0;i<12;i++)ellipse(286+i*5,594+(i%3)*5,1.5,1.5,'#d6bf88');
    drawExpandedCity();drawNeighborhoodDetails();
    miniBackground.width=300;miniBackground.height=200;miniBackground.getContext('2d').drawImage(staticLayer,0,0,300,200);
    g=ctx;
  }
  function drawExpandedCity(){
    // These are additional world coordinates, not a stretched version of the lake.
    rounded(1200,0,900,800,0,'#e8eddb');rounded(2100,0,900,800,0,'#e3e9dd');
    rounded(0,800,1000,1200,0,'#dfead3');rounded(1000,800,1000,1200,0,'#e4ecdb');rounded(2000,800,1000,1200,0,'#e7ecdb');
    // Qiantang River crosses the southern city; bridges connect both banks.
    g.beginPath();g.moveTo(0,1210);g.bezierCurveTo(800,1170,1440,1300,3000,1200);g.lineTo(3000,1330);g.bezierCurveTo(1620,1430,850,1320,0,1350);g.closePath();g.fillStyle='#bad8c7';g.fill();
    g.beginPath();g.moveTo(0,1200);g.bezierCurveTo(800,1160,1440,1290,3000,1190);g.strokeStyle='#f1eed8';g.lineWidth=12;g.stroke();
    g.beginPath();g.moveTo(0,1360);g.bezierCurveTo(850,1330,1620,1440,3000,1340);g.strokeStyle='#eeeccf';g.lineWidth=14;g.stroke();
    for(let i=0;i<19;i++){const x=80+i*160;ellipse(x,1270+Math.sin(i*.8)*28,30,3,'#dcebdd66')}
    label('钱   塘   江',1570,1310,30,'#83af99',400);
    function vertical(x,from=86,to=1950){
      rounded(x-45,from,90,to-from,7,'#f8f7ec');rounded(x-35,from,70,to-from,3,'#d9dfd4');
      g.setLineDash([12,13]);line(x,from,x,to,'#fbfcf4',2);g.setLineDash([]);
      for(let y=from+35;y<to-20;y+=130){
        if(y>1170&&y<1400)continue;
        if(clearOfRoads({x:x-82,y:y-24,w:36,h:46}))tree(x-65,y,11,(x+y)%4);
        if(clearOfRoads({x:x+49,y:y-5,w:24,h:21}))bush(x+49,y-5,20);
      }
    }
    function horizontal(y,from=24,to=2976){
      rounded(from,y-44,to-from,88,10,'#f8f7ec');rounded(from,y-34,to-from,68,3,'#d9dfd4');
      g.setLineDash([12,13]);line(from,y,to,y,'#fbfcf4',2);g.setLineDash([]);
    }
    const columns=[440,750,1040,1320,1740,2040,2340,2740];
    columns.forEach(x=>vertical(x,x<1200?740:86));
    horizontal(245,1200);horizontal(525,1200);horizontal(730,1040);[1030,1470,1750].forEach(y=>horizontal(y));
    columns.forEach(x=>{
      const ys=x<1200?[1030,1470,1750]:[245,525,730,1030,1470,1750];
      ys.forEach(y=>{rounded(x-35,y-34,70,68,2,'#d9dfd4');crosswalk(x-63,y);crosswalk(x,y+60,true);signal(x+43,y+34)});
      // Bridge piers and guard rails remain visible along each crossing.
      line(x-42,1204,x-42,1362,'#a6b9a0',3);line(x+42,1204,x+42,1362,'#a6b9a0',3);
      for(let yy=1215;yy<1360;yy+=23){line(x-47,yy,x-38,yy,'#dce5c8',3);line(x+38,yy,x+47,yy,'#dce5c8',3)}
    });
    // Canal district: a real water corridor, bridges, courtyard homes and market.
    rounded(1478,0,74,708,5,'#b5d2c0');line(1470,0,1470,708,'#f2ecd7',8);line(1560,0,1560,708,'#f2ecd7',8);
    [245,525].forEach(y=>{rounded(1460,y-34,111,68,4,'#e4e5ce');line(1463,y-30,1567,y-30,'#a9b99b',2);line(1463,y+30,1567,y+30,'#a9b99b',2);for(let xx=1469;xx<1570;xx+=15)line(xx,y-25,xx,y+25,'#d2d8bd',2)});
    // Keep every roof, including eaves and shadows, inside its city block.
    for(const y of [110,330,420]){traditional(1203,y,48,39);traditional(1390,y,50,42)}
    traditional(1592,340,76,44);traditional(1592,420,76,44);
    traditional(1604,110,74,52);building(1810,100,124,76,'#c9cfb5','#edead4',1);building(1807,342,150,86,'#b9cdbb','#e7ebd8',0);
    rounded(1375,584,88,97,10,'#d4e0bf');rounded(1571,584,112,97,10,'#d4e0bf');
    traditional(1390,601,61,43);traditional(1590,600,75,44);
    [1394,1440,1592,1652].forEach((x,i)=>tree(x,665,10,i));
    label('拱 宸 桥',1515,222,15,'#799578');label('桥西历史街区',1517,710,14,'#8b9c78');
    label('运 河 · 拱 宸',1645,64,23,'#76926e',600);
    // East station: arched station roof, several railway tracks and bus bays.
    for(let i=0;i<6;i++){
      const yy=92+i*13;
      for(const [left,right] of [[2390,2690],[2790,2954]]){
        line(left,yy,right,yy,'#acb9a5',2);
        for(let x=left;x<right;x+=15)line(x,yy-3,x,yy+3,'#c6cdb8',1);
      }
    }
    structure('station-hall',2416,69,268,119);
    rounded(2416,76,268,112,20,'#bacbbd');rounded(2427,69,246,106,24,'#edf0e4');
    for(let i=0;i<9;i++)rounded(2437+i*25,82,15,77,7,'#c0d3c9');
    rounded(2444,94,212,51,8,'#e8eee1');label('杭 州 东 站',2550,128,23,'#759688',600);
    building(2155,104,122,77,'#b7ccbe','#e4eddf',2);building(2155,331,110,97,'#bac9b8','#e6ebda',0);
    building(2403,330,128,96,'#bdcfc2','#e8eee0',2);building(2574,337,94,77,'#c8c9b1','#ede9d1',1);
    rounded(2395,584,298,100,12,'#dae3ce');
    for(let i=0;i<4;i++){rounded(2412+i*67,597,54,20,3,'#faf9e9');rounded(2416+i*67,600,44,13,3,'#b7cab2')}
    building(2795,340,135,87,'#b5c6b6','#e6eadb',1);building(2799,582,126,78,'#c4cab0','#edead5',0);
    label('站 前 接 驳 广 场',2555,677,14,'#899976');label('东 站 · 枢 纽',2590,47,22,'#779280',600);
    // Distinct city blocks south of the river.
    const blocks=[[65,325],[496,205],[798,190],[1095,170],[1377,303],[1795,190],[2095,190],[2395,290],[2793,160]];
    for(const [x,width] of blocks){
      for(const y of [858,1534,1812]){
        if((x<1000&&y===858)||(x>2000&&y===1534)||(x>1300&&x<1700&&y===1812)||([65,496].includes(x)&&y===1534)||(x===2793&&y===1812))continue;
        const warm=x<1000,roof=warm?'#eee8d2':'#e7eddf',base=warm?'#c8c7ac':'#becfbd';
        rounded(x-11,y-15,width+20,135,12,warm?'#d6e1c2':'#dbe5cf');
        if(width>250){building(x,y,width*.45,84,base,roof,2);building(x+width*.54,y+6,width*.42,72,base,roof,1)}
        else building(x+8,y,width-15,82,base,roof,(Math.floor(x/100)+Math.floor(y/100))%3);
        tree(x+width*.25,y+112,12,0);tree(x+width*.77,y+110,13,2);bench(x+width*.5,y+109);
      }
    }
    // Tea hills and a cultural museum make Zhijiang different from the grid.
    ellipse(210,895,160,73,'#c9dcb7');ellipse(206,909,136,60,'#b8cfa4');
    for(let i=0;i<7;i++){g.beginPath();g.ellipse(208,895+i*7,115-i*6,28,0,Math.PI*.12,Math.PI*.88);g.strokeStyle=i%2?'#98b785':'#e0e8c9';g.lineWidth=5;g.stroke()}
    traditional(175,869,64,44);label('龙井茶园',208,994,17,'#82996f');
    rounded(512,865,171,111,10,'#d3d8bd');building(526,874,145,81,'#c6cbb2','#efe9d6',1);label('之江文化馆',600,995,16,'#8a9777');
    traditional(94,1557,122,75);traditional(247,1558,114,75);label('宋 韵 文 化 街',218,1695,17,'#87936e');
    label('之 江 · 文 旅',541,832,23,'#7e966a',600);
    // Binjiang: science campus and athletics park with an oval track.
    building(1111,1102,143,73,'#b2cdbd','#e3ece0',2);building(1395,1100,123,78,'#b0c5bd','#e5eddf',2);building(1562,1101,117,78,'#b4c8bb','#e7eedf',2);
    rounded(1378,1811,302,131,20,'#d5e3c6');ellipse(1532,1876,122,52,'#bfbea0');ellipse(1532,1876,109,41,'#e9d7b4');ellipse(1532,1876,93,31,'#adc693');
    line(1450,1876,1614,1876,'#e0e9cf',2);g.strokeStyle='#e0e9cf';g.lineWidth=2;g.strokeRect(1461,1849,141,53);ellipse(1532,1876,15,15,'#c1d2aa');
    label('青 年 运 动 公 园',1533,1971,15,'#829b75');label('滨 江 · 科 创',1530,832,23,'#799276',600);
    label('智 慧 园 区',1530,1008,15,'#8b9b7d');
    // Qianjiang: gold sun and silver moon on a large public plaza.
    // The landmark plaza sits east of Qianjiang Road; its western garden is separate.
    structure('civic-plaza',2392,1519,296,173);
    rounded(2392,1519,296,173,22,'#e7e5cb');rounded(2400,1530,280,144,17,'#eeead3');
    ellipse(2460,1605,63,51,'#cfbd8e');ellipse(2451,1593,54,46,'#e2cd96');
    for(let a=-1.3;a<1.4;a+=.15)line(2451,1547,2451+Math.sin(a)*57,1594+Math.cos(a)*38,'#c1ab77',1.3);
    rounded(2582,1538,74,113,21,'#b1c6ba');rounded(2589,1534,60,104,18,'#dae3d2');
    for(let xx=2598;xx<2645;xx+=8)line(xx,1545,xx,1626,'#a3bfb1',2);
    building(2130,1100,155,82,'#b4c8bd','#e7eddd',2);building(2410,1103,112,78,'#b8c9b9','#e7ecda',2);building(2571,1100,108,79,'#b8cbbd','#e7eedf',2);
    for(let i=0;i<12;i++){const x=2120+i*72;if(clearOfRoads({x:x-22,y:1377,w:45,h:48}))tree(x,1403,14,i)}
    label('日 月 同 辉 · 市 民 广 场',2460,1708,17,'#8b9573');label('钱 江 · 新 城',2537,832,23,'#7d9275',600);
    label('城 市 阳 台',2450,1443,16,'#87a180');
    // Lotus pavilion at the far east is a destination beyond the old map edge.
    ellipse(2868,1875,68,39,'#cadbc0');
    for(let i=0;i<7;i++){g.save();g.translate(2868,1862);g.rotate((i-3)*.25);ellipse(0,-12,12,34,i%2?'#e8e8d5':'#d3ddc7');g.restore()}
    label('江畔莲花亭',2868,1932,15,'#809878');
  }
  function flowerbed(x,y,w=40,h=15,tone=0){
    rounded(x,y,w,h,Math.min(7,h/2),'#c0d0a5');
    const petals=['#dfbd99','#e5d6a4','#d4b6a6'];
    for(let i=0;i<Math.floor(w/9);i++){
      const xx=x+6+i*9,yy=y+5+(i%2)*4;
      line(xx,yy+4,xx,yy+7,'#98ad86',1);
      ellipse(xx,yy,2.5,2,petals[(i+tone)%3]);ellipse(xx+1,yy,1,1,'#faf0cc');
    }
  }
  function bicycleRack(x,y,count=4){
    for(let i=0;i<count;i++){
      const xx=x+i*13;
      line(xx-3,y+5,xx-3,y-6,'#97af99',2);line(xx-3,y-6,xx+4,y-6,'#97af99',2);line(xx+4,y-6,xx+4,y+5,'#97af99',2);
      g.strokeStyle='#849d88';g.lineWidth=1.4;g.beginPath();g.ellipse(xx,y+4,6,3,0,0,Math.PI*2);g.stroke();
      line(xx,y+3,xx+2,y-4,'#ccb481',2);
    }
  }
  function lamp(x,y){
    ellipse(x+3,y+7,5,2,'#6d89551a');line(x,y+7,x,y-11,'#93a58c',2);
    rounded(x-4,y-15,8,5,2,'#f1e5bd');line(x-5,y-16,x+5,y-16,'#98a58b',2);
  }
  function gardenPlot(x,y,w,h,kind,name){
    const bounds={x,y,w,h};cityAmenities.push({kind,name,...bounds});
    const cx=x+w/2,cy=y+h/2;
    rounded(x,y,w,h,12,'#d3e0c3');rounded(x+5,y+5,w-10,h-10,9,'#e0e8cf');
    // Paths stay inside their parcel, leaving junctions and lesson markers readable.
    rounded(x+12,cy-6,w-24,12,4,'#f1ecd6');rounded(cx-5,y+10,10,h-20,3,'#efe9d1');
    if(kind==='garden'){
      ellipse(cx,cy,Math.min(32,w*.2),Math.min(24,h*.24),'#bdcfb1');
      ellipse(cx,cy,Math.min(25,w*.16),Math.min(18,h*.18),'#c1dbca');
      ellipse(cx-3,cy-3,Math.min(17,w*.11),Math.min(10,h*.11),'#dce8d6');
      flowerbed(x+16,y+13,Math.min(45,w*.27));flowerbed(x+w-Math.min(45,w*.27)-16,y+h-28,Math.min(45,w*.27),15,1);
      bench(cx-38,cy+24);bench(cx+38,cy-24);
    }else if(kind==='playground'){
      rounded(x+17,y+17,w-34,h-34,10,'#dfd6b4');
      ellipse(cx-26,cy+5,21,16,'#c1d3b2');
      line(cx-34,cy-15,cx-43,cy+17,'#b29d79',3);line(cx-34,cy-15,cx-21,cy+17,'#b29d79',3);
      line(cx-34,cy-15,cx-9,cy-15,'#b29d79',3);line(cx-9,cy-15,cx+2,cy+17,'#b29d79',3);
      line(cx-27,cy-13,cx-27,cy+4,'#9da88c',1.4);line(cx-16,cy-13,cx-16,cy+4,'#9da88c',1.4);rounded(cx-30,cy+3,19,5,2,'#d2b58a');
      rounded(cx+22,cy-17,22,17,4,'#b2c8bb');path([[cx+37,cy-2],[cx+53,cy+21],[cx+43,cy+24],[cx+29,cy+1]],'#d9bd8e');
      bench(x+32,y+h-13);flowerbed(x+w-62,y+9,43);
    }else if(kind==='market'){
      for(let i=0;i<3;i++){
        const xx=x+16+i*(w-28)/3,ww=(w-40)/3;
        rounded(xx,y+22,ww,34,3,'#e8e4cf');rounded(xx-2,y+16,ww+4,16,3,i%2?'#b9c9b1':'#d6bf9a');
        for(let j=0;j<3;j++)rounded(xx+3+j*(ww-2)/3,y+17,4,13,1,'#f0e9d4');
        flowerbed(xx+4,y+41,Math.max(17,ww-10),8,i);
      }
      bicycleRack(x+25,y+h-18,3);bench(x+w-31,y+h-19);
    }else if(kind==='charging'){
      rounded(x+12,y+13,w-24,h-26,8,'#d6dec8');
      for(let i=0;i<3;i++){
        const xx=x+22+i*(w-34)/3;
        g.strokeStyle='#f6f7e8';g.lineWidth=2;g.strokeRect(xx,cy-18,(w-55)/3,42);
        rounded(xx+5,y+18,9,15,2,'#9db9a6');path([[xx+10,y+20],[xx+7,y+26],[xx+11,y+26],[xx+9,y+31]],'#eaf1d9');
        if(i<2)car(xx+(w-55)/6,cy+3,i?'#c9bea0':'#abc2b4',-Math.PI/2);
      }
      flowerbed(cx-25,y+h-19,50,10);
    }else if(kind==='tea'){
      for(let row=0;row<4;row++){
        const yy=y+20+row*(h-36)/4;
        rounded(x+17,yy,w-34,8,4,row%2?'#aec395':'#a2bb8a');
        for(let xx=x+22;xx<x+w-20;xx+=14)ellipse(xx,yy+2,4,2,'#c9d6af');
      }
      bench(cx,y+h-11);flowerbed(x+11,y+9,31,9);
    }else if(kind==='reading'){
      building(x+17,y+18,Math.min(83,w*.5),48,'#bacbbb','#ebe9d5',1);
      rounded(x+w-61,cy-7,35,21,3,'#d9cfaf');
      rounded(x+w-54,cy-3,10,11,1,'#f3f0dc');line(x+w-49,cy-2,x+w-49,cy+7,'#b5b79b',1);
      bench(x+w-44,cy+27);flowerbed(x+20,y+h-25,45,11);
    }else if(kind==='sports'){
      rounded(x+16,y+14,w-32,h-28,6,'#b6c9aa');
      g.strokeStyle='#eef0d8';g.lineWidth=1.5;g.strokeRect(x+23,y+20,w-46,h-40);
      line(cx,y+20,cx,y+h-20,'#edf0d7',1.5);ellipse(cx,cy,13,13,'#d2ddbc');
      g.strokeRect(x+23,cy-17,24,34);g.strokeRect(x+w-47,cy-17,24,34);
      line(x+27,cy-7,x+27,cy+7,'#b18c6a',3);line(x+w-27,cy-7,x+w-27,cy+7,'#b18c6a',3);
    }else if(kind==='bikes'){
      rounded(x+16,y+17,w-32,26,5,'#bdcdb5');
      line(x+20,y+15,x+w-20,y+15,'#e9ecda',3);
      bicycleRack(x+29,y+47,Math.min(8,Math.floor((w-48)/13)));
      rounded(x+w-37,y+h-36,13,22,3,'#8dad9d');rounded(x+w-34,y+h-32,7,8,1,'#dbe7d7');
      flowerbed(x+17,y+h-29,Math.min(48,w-75),12);
    }
    if(!['tea','sports','market','bikes'].includes(kind)){
      tree(x+14,y+h-20,9,0);tree(x+w-16,y+22,9,2);
    }
    lamp(x+w-13,y+h-17);
    if(name)label(name,cx,y+h+15,11,'#8c9b7b');
  }
  function drawNeighborhoodDetails(){
    // Small, authored programs give the empty parcels different local identities.
    const plots=[
      [1800,582,178,87,'market','桥畔便民集'],
      [2098,583,175,88,'bikes','绿色接驳点'],
      [2398,443,271,31,'tea',''],
      [2804,453,130,28,'tea',''],
      [64,1090,316,83,'tea','茶香慢行园'],
      [503,1087,181,85,'reading','江畔阅读角'],
      [806,1087,176,85,'garden','滨水小花园'],
      [1804,1087,177,85,'charging','绿色充电驿站'],
      [2803,1087,151,85,'bikes','江畔骑行驿站'],
      [2110,1524,174,163,'garden','市民共享花园'],
      [2804,1524,151,162,'playground','邻里儿童乐园'],
      [503,1524,181,151,'sports','邻里球场'],
      [802,784,179,18,'tea',''],
      [1101,784,159,18,'tea',''],
      [1391,784,277,18,'tea',''],
      [1803,784,177,18,'tea',''],
      [2110,784,165,18,'tea',''],
      [2408,784,259,18,'tea',''],
      [2805,784,148,18,'tea','']
    ];
    // A narrow planted verge uses low shrubs instead of full-size park furniture.
    for(const [x,y,w,h,kind,name] of plots){
      if(h<40){
        cityAmenities.push({kind:'planted-verge',name:'街区花境',x,y,w,h});
        rounded(x,y,w,h,8,'#d6e1c7');
        flowerbed(x+9,y+5,w-18,Math.min(16,h-10),Math.floor(x/100)%3);
      }else gardenPlot(x,y,w,h,kind,name);
    }
    // Courtyard paths, planted front gardens and bicycle parking finish built blocks.
    const blocks=[[65,325],[496,205],[798,190],[1095,170],[1377,303],[1795,190],[2095,190],[2395,290],[2793,160]];
    for(const [x,w] of blocks){
      for(const y of [858,1534,1812]){
        if((x<1000&&y===858)||(x>2000&&y===1534)||(x>1300&&x<1700&&y===1812)||([65,496].includes(x)&&y===1534)||(x===2793&&y===1812))continue;
        rounded(x+14,y+95,w-28,7,3,'#eee8d2');
        flowerbed(x+12,y+119,Math.min(55,w*.28),10,Math.floor(x/100)%3);
        flowerbed(x+w-Math.min(55,w*.28)-11,y+119,Math.min(55,w*.28),10,1);
        if(w>250)bicycleRack(x+w*.7,y+98,4);
      }
    }
    // The Song-style lane and lotus garden each keep their own open courtyard.
    rounded(75,1652,294,10,4,'#eee6ce');flowerbed(86,1639,72,13);flowerbed(267,1639,72,13,2);bench(219,1655);
    gardenPlot(2804,1819,151,120,'garden','');
    // Restore the pavilion on top of its garden, without placing a house underneath it.
    ellipse(2868,1875,53,31,'#c0d3b3');
    for(let i=0;i<7;i++){g.save();g.translate(2868,1862);g.rotate((i-3)*.25);ellipse(0,-12,12,34,i%2?'#e8e8d5':'#d3ddc7');g.restore()}
    label('江畔莲花亭',2868,1958,13,'#809878');
    // Riverfront paths and gardens use land between the banks and roads only.
    for(const [left,right] of [[28,375],[505,685],[805,975],[1105,1255],[1390,1670],[1810,1975],[2110,2270],[2410,2670],[2810,2950]]){
      line(left,1407,right,1407,'#efe9d0',8);
      for(let x=left+24;x<right-12;x+=64){tree(x,1384,9,Math.floor(x/64)%4);bench(x+14,1411);}
    }
    // Compact canal-side terraces retain a continuous, uncovered water corridor.
    for(const y of [180,398]){
      bench(1420,y);flowerbed(1384,y-12,28,10,2);
      bench(1624,y+5);flowerbed(1590,y-8,28,10,1);
    }
    flowerbed(1810,304,158,15,1);
    // Reuse small roof panels as a local science-campus detail.
    for(const [x,y,w] of [[1127,1116,100],[1410,1114,86],[1577,1115,79]]){
      for(let i=0;i<Math.floor(w/22);i++){
        rounded(x+i*22,y,17,24,2,'#92b4ab');line(x+i*22+8,y+2,x+i*22+8,y+22,'#c6dbce',1);line(x+i*22+2,y+12,x+i*22+15,y+12,'#c6dbce',1);
      }
    }
  }
  function car(x,y,color='#afc4b2',angle=0,large=false){
    g.save();g.translate(x,y);g.rotate(angle);const l=large?40:32;
    rounded(-l/2+3,-8+4,l,17,5,'#68866d20');rounded(-l/2,-9,l,18,5,color);rounded(-7,-7,13,14,3,'#dce5d8');rounded(-5,-6,9,12,2,'#91aaa0');line(3,-6,3,6,'#c2d1c4',2);rounded(l/2-3,-6,2,4,1,'#f7eed3');rounded(l/2-3,2,2,4,1,'#f7eed3');rounded(-l/2,-6,2,3,1,'#d5a18c');g.restore();
  }
  function person(x,y,color='#b49473',angle=0){
    g.save();g.translate(x,y);g.rotate(angle);ellipse(3,7,6,3,'#59745422');line(-3,4,-4,10,'#76897a',2);line(3,4,4,10,'#76897a',2);rounded(-5,-4,10,10,3,color);ellipse(0,-7,4.7,4.7,'#ddc4a3');ellipse(0,-9,4.5,2.6,'#8b8670');g.restore();
  }
  function bicycle(x,y,angle=0,color='#b2986c'){
    g.save();g.translate(x,y);g.rotate(angle);g.strokeStyle='#819681';g.lineWidth=2;g.beginPath();g.ellipse(-9,1,5,3,0,0,Math.PI*2);g.ellipse(9,1,5,3,0,0,Math.PI*2);g.stroke();line(-9,0,8,0,'#c9ac77',3);rounded(-5,-5,10,9,3,color);ellipse(0,-8,4,4,'#e3c6a0');g.restore();
  }
  function drawTargets(t){
    if(t.x<camera.x-110||t.x>camera.x+camera.w+110||t.y<camera.y-110||t.y>camera.y+camera.h+110)return;
    const shift=t.done?1:0;
    if(t.type==='redlight'){person(t.x,t.y+shift*51,'#cda881');if(!t.done){rounded(t.x-19,t.y-48,8,16,3,'#879987');ellipse(t.x-15,t.y-43,2.5,2.5,'#df9478')}}
    if(t.type==='parking'){if(t.done){rounded(t.x-24,t.y+40,48,29,3,'#edf0de');g.strokeStyle='#b6c7a7';g.lineWidth=1.5;g.strokeRect(t.x-21,t.y+43,42,23);label('P',t.x+33,t.y+58,11,'#8fa983')}car(t.x,t.y+(t.done?54:0),'#d0ae88',t.done?0:.13);if(!t.done){path([[t.x-25,t.y+15],[t.x-20,t.y+5],[t.x-15,t.y+15]],'#e9bd92');line(t.x-22,t.y+11,t.x-18,t.y+11,'#f9e7c9',2)}}
    if(t.type==='yield'){car(t.x+(t.done?0:0),t.y+(t.done?42:0),'#93b7ae',-Math.PI/2);person(t.x+16,t.y-24+(t.done?-35:0),'#c1b487')}
    if(t.type==='wrongway')bicycle(t.x+25,t.y,t.done?-Math.PI/2:Math.PI/2,'#a7b591');
    if(!['redlight','parking','yield','wrongway'].includes(t.type))drawSpecialEvent(t);
    const mx=t.x,my=t.y-36;
    const scale=Math.max(1,Math.min(1.6,.65/sx));g.save();g.translate(mx,my);g.scale(scale,scale);
    if(t.done){ellipse(0,0,12,12,'#eff7e8');ellipse(0,0,9,9,'#a3bf95');line(-4,0,-1,3,'#fff',2);line(-1,3,5,-4,'#fff',2)}
    else {
      const pulse=reduced?0:(Math.sin(cityTime*2.5+t.id)*.5+.5);
      ellipse(0,2,20+pulse*4,20+pulse*4,'#e8b0851a');ellipse(0,2,16,16,'#ffffffdf');ellipse(0,0,12,12,'#e9a16e');
      rounded(-1.1,-6,2.2,8,1,'#fff9ed');ellipse(0,5,1.4,1.4,'#fff9ed');path([[-4,12],[4,12],[0,18]],'#e9a16e');
    }g.restore();
    if(!t.done&&Math.hypot(drone.x-t.x,drone.y-t.y)<340)label(traffic[t.type].name,t.x,t.y+37,11,'#938e70');
  }
  function drawSpecialEvent(t){
    const x=t.x,y=t.y,done=t.done;
    if(traffic[t.type].kind==='bike'){
      if(t.type==='walkbike'){crosswalk(x,y);bicycle(x+(done?12:0),y,0,'#b1b88c');if(done)person(x-10,y,'#c0ab86')}
      else bicycle(x+(done&&t.type==='wronglane'?43:0),y,t.type==='helmet'?0:-Math.PI/2,'#aeb58c');
      if(t.type==='helmet'){rounded(x-12,y+5,24,5,2,'#9fbaa2');label('电动',x+23,y+6,7,'#8d9e7a');if(done){ellipse(x,y-8,5,5,'#e6c58d');line(x-4,y-6,x+4,y-6,'#f7ead1',2)}}
      if(t.type==='stunt'&&!done){line(x-4,y-4,x-16,y-13,'#b9a286',3);line(x+4,y-4,x+16,y-13,'#b9a286',3)}
      if(t.type==='wronglane'){line(x+28,y-35,x+28,y+40,'#a8bd91',3);label('骑行道',x+61,y+31,9,'#9baa83')}
      return;
    }
    if(t.type==='barrier'){
      rounded(x-40,y+6,80,4,2,'#b2bda7');for(let xx=x-37;xx<x+40;xx+=11)line(xx,y-7,xx,y+17,'#99ad93',3);person(x,y+(done?-34:0),'#c1ad8b');return;
    }
    if(t.type==='overload'){
      const count=done?2:6;rounded(x-27,y-14,53,29,4,'#a8bfa4');rounded(x+15,y-12,17,25,4,'#d8dfca');rounded(x+19,y-8,8,16,2,'#8fa99d');
      for(let i=0;i<count;i++)rounded(x-24+(i%3)*12,y-11+Math.floor(i/3)*12,10,10,1,i%2?'#ceb98e':'#e1cea3');
      if(done){rounded(x-31,y+26,16,13,2,'#d7c398');rounded(x-10,y+26,16,13,2,'#e1ceaa')}return;
    }
    const park=done&&['busstop','firelane','phone','fatigue'].includes(t.type);
    if(t.type==='solidline'){line(x-40,y,x+40,y,'#f5ebba',3);line(x-40,y+6,x+40,y+6,'#f5ebba',3)}
    car(x+(park?-48:0),y+(park?54:t.type==='solidline'&&done?-24:0),t.type==='horn'?'#b8c3a8':'#c2b993',t.type==='solidline'&&!done?.45:0,true);
    if(t.type==='seatbelt'){if(done)line(x-5,y-7,x+5,y+6,'#516f60',2);else label('未系',x,y-20,8,'#b69b77')}
    if(t.type==='phone'&&!done){rounded(x+6,y-14,6,12,1,'#6e8b7d');rounded(x+7,y-12,4,7,1,'#deead7')}
    if(t.type==='door'&&!done){line(x-6,y-9,x-11,y-28,'#b8a77e',4);line(x-11,y-28,x+4,y-26,'#b8a77e',3)}
    if(t.type==='indicator'){line(x-37,y+20,x+34,y+20,'#adc3a1',2);if(done){ellipse(x+17,y-7,3,2,'#e5b36c');ellipse(x+17,y+7,3,2,'#e5b36c')}}
    if(t.type==='litter'){if(!done){rounded(x+29,y+15,8,6,1,'#f5ead4');rounded(x+42,y+6,5,7,1,'#e4d3b2')}else{rounded(x+38,y+17,12,18,3,'#98b38c');line(x+37,y+16,x+51,y+16,'#779975',2)}}
    if(t.type==='horn'){rounded(x+42,y-18,24,28,4,'#f4f0dc');label('禁鸣',x+54,y,9,'#a3946b');if(!done){for(let i=0;i<3;i++){g.beginPath();g.arc(x-21,y,10+i*5,Math.PI*.72,Math.PI*1.28);g.strokeStyle='#d8aa72';g.lineWidth=1.4;g.stroke()}}}
    if(t.type==='busstop'){
      rounded(x+39,y+14,62,25,5,'#a0bc9b');rounded(x+47,y+18,45,10,2,'#d8e4d0');rounded(x-8,y-60,58,15,4,'#b3c3a0');label('公交站',x+21,y-49,9,'#f8f6e8');person(x+75,y-14,'#b8b393');
    }
    if(t.type==='firelane'){g.strokeStyle='#d0a18a';g.lineWidth=2;g.strokeRect(x-45,y-23,91,48);label('消防通道',x,y+42,11,'#b48f77')}
    if(t.type==='fatigue'){if(!done)label('Z z',x+21,y-17,14,'#a09478',600);else{rounded(x-15,y-14,22,28,4,'#edf1dd');label('P',x-4,y+5,17,'#8fa77d');person(x+16,y+50,'#bdad86')}}
    if(park){g.strokeStyle='#c2cfad';g.lineWidth=1.5;g.strokeRect(x-72,y+39,48,30)}
  }
  function drawDrone(){
    const hover=reduced?0:Math.sin(cityTime*3)*2,scale=Math.max(1,Math.min(1.45,.6/sx));
    const near=nearest(),inRange=near&&near.d<RANGE;
    if(mode==='running'||mode==='ready'){
      g.beginPath();g.arc(drone.x,drone.y,RANGE,0,Math.PI*2);g.fillStyle='#008b6f07';g.fill();g.strokeStyle=inRange?'#169b7b55':'#55a78936';g.lineWidth=1.2;g.setLineDash([5,7]);g.stroke();g.setLineDash([]);
      if(mode==='running'&&!reduced){g.save();g.translate(drone.x,drone.y);g.rotate(cityTime*.6);g.beginPath();g.moveTo(0,0);g.arc(0,0,RANGE,-.6,0);g.closePath();g.fillStyle='#439d7810';g.fill();g.restore()}
    }
    trail.forEach((p,i)=>ellipse(p.x,p.y,1.4,1.4,'#4d9d7930'));
    ellipse(drone.x+7,drone.y+23,21*scale,8*scale,'#385f4530');
    g.save();g.translate(drone.x,drone.y-9+hover);g.scale(scale,scale);g.rotate(Math.max(-.12,Math.min(.12,drone.vx/1800)));
    for(const [x,y] of [[-22,-17],[22,-17],[-22,17],[22,17]]){line(x,y,x*.32,y*.35,'#608f80',5);ellipse(x,y,13,8,'#fcfdf0');g.strokeStyle='#c4d6c0';g.lineWidth=1;g.stroke();const angle=cityTime*23+x;g.save();g.translate(x,y);g.rotate(reduced?0:angle);ellipse(0,0,11,2.5,'#94baa18c');g.restore();ellipse(x,y,3,3,'#6b9e8b')}
    rounded(-12,-16,24,32,8,'#a8c9b3');rounded(-12,-19,24,31,8,'#fcfdf2');rounded(-8,-13,16,16,5,'#0a8975');
    ellipse(-3,-7,1.8,2,'#dbf5e4');ellipse(3,-7,1.8,2,'#dbf5e4');g.beginPath();g.arc(0,-4,3,0,Math.PI);g.strokeStyle='#c3e7ce';g.lineWidth=1.1;g.stroke();ellipse(0,7,3.5,2.5,'#71a58d');g.restore();
    label('小 杭',drone.x,drone.y+45*scale,11,'#348a71',600);
  }
  function drawScene(){
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cssW,cssH);ctx.setTransform(dpr*sx,0,0,dpr*sy,-camera.x*sx*dpr,-camera.y*sy*dpr);g=ctx;
    g.drawImage(staticLayer,camera.x,camera.y,camera.w,camera.h,camera.x,camera.y,camera.w,camera.h);
    // Calm city traffic; all simulation stops during conversations.
    const colors=['#b3c2ad','#d1c6a4','#9ab9b2','#f1efdb'];
    for(let i=0;i<24;i++){
      const lane=(i<12?245:1470)+(i%2?18:-18);let x=368+((cityTime*(i%2?-19:22)+i*157+900)%2580+2580)%2580;
      // Leave the active lesson crossings clear.
      if(targets.some(t=>!t.done&&Math.abs(t.y-lane)<40&&Math.abs(t.x-x)<65))continue;
      car(x,lane,colors[i%4],i%2?Math.PI:0);
    }
    for(let i=0;i<3;i++){const y=100+((cityTime*17+i*180)%580);if(Math.abs(y-245)>65&&Math.abs(y-525)>65)car(768,y,colors[i],Math.PI/2)}
    [[369,368],[389,602],[811,443],[1092,463],[660,186]].forEach(([x,y],i)=>person(x+Math.sin(cityTime*.3+i)*5,y,'#b9bc9c'));
    // Boats move slowly, without affecting traffic objectives.
    [[105,268],[271,467]].forEach(([x,y],i)=>{g.save();g.translate(x+Math.sin(cityTime*.12+i)*4,y);g.rotate(-.35);ellipse(0,3,13,4,'#91b6a344');path([[-11,0],[-6,-4],[8,-4],[13,0],[7,5],[-6,5]],'#ece0bb');line(0,-4,0,4,'#b6a987',2);g.restore()});
    targets.forEach(drawTargets);
    if(destination&&mode==='running'){const s=reduced?10:10+Math.sin(cityTime*5)*2;g.beginPath();g.arc(destination.x,destination.y,s,0,Math.PI*2);g.strokeStyle='#359a7d';g.lineWidth=1.5;g.stroke();line(destination.x-5,destination.y,destination.x+5,destination.y,'#359a7d',1);line(destination.x,destination.y-5,destination.x,destination.y+5,'#359a7d',1)}
    particles.forEach(p=>ellipse(p.x,p.y,2.5*p.life,2.5*p.life,'#75ad7b'));
    drawDrone();
    drawMiniMap();
  }
  function resize(){
    const box=stage.getBoundingClientRect();if(box.width<1||box.height<1)return;
    cssW=box.width;cssH=box.height;dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(cssW*dpr);canvas.height=Math.round(cssH*dpr);
    sx=sy=Math.max(cssW/1200,cssH/800);camera.w=cssW/sx;camera.h=cssH/sy;followCamera(1,true);
    const miniBox=mini.getBoundingClientRect();mini.width=Math.round(miniBox.width*dpr);mini.height=Math.round(miniBox.height*dpr);drawScene();
  }
  let uiTick=0,trailTick=0,nearbyTick=0;
  function frame(now){
    const elapsed=Math.max(0,(now-last)/1000);last=now;const dt=Math.min(elapsed,.05);
    if(mode==='running'){
      remaining=Math.max(0,remaining-elapsed);cityTime+=dt;
      if(remaining<=0){finish()}
      else {
        let dx=(keys.has('right')?1:0)-(keys.has('left')?1:0),dy=(keys.has('down')?1:0)-(keys.has('up')?1:0);
        if(!dx&&!dy&&destination){dx=destination.x-drone.x;dy=destination.y-drone.y;if(Math.hypot(dx,dy)<6){destination=null;dx=0;dy=0}}
        let length=Math.hypot(dx,dy);if(length){dx/=length;dy/=length}
        const speed=SPEED*(boost||keys.has('boost')?1.7:1);
        const smooth=1-Math.exp(-14*dt);drone.vx+=(dx*speed-drone.vx)*smooth;drone.vy+=(dy*speed-drone.vy)*smooth;
        drone.x=Math.max(28,Math.min(W-28,drone.x+drone.vx*dt));drone.y=Math.max(46,Math.min(H-40,drone.y+drone.vy*dt));
        if((drone.x===28&&drone.vx<0)||(drone.x===W-28&&drone.vx>0))drone.vx=0;if((drone.y===46&&drone.vy<0)||(drone.y===H-40&&drone.vy>0))drone.vy=0;
        if(autoTarget&&!autoTarget.done&&Math.hypot(drone.x-autoTarget.x,drone.y-autoTarget.y)<RANGE*.78)scan(autoTarget);
        if(mode==='running'){
          followCamera(dt);
          const district=districts.find(d=>drone.x>=d.x&&drone.x<d.x+d.w&&drone.y>=d.y&&drone.y<d.y+d.h);
          if(district){$('currentDistrict').textContent='杭州 · '+district.name;if(!visited.has(district.id)){visited.add(district.id);$('exploredCount').textContent=visited.size+'/6';toast('发现新街区 · '+district.name)}}
        }
        trailTick+=dt;if(trailTick>.08){trailTick=0;if(Math.hypot(drone.vx,drone.vy)>20)trail.push({x:drone.x,y:drone.y});if(trail.length>14)trail.shift()}
        particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.life=Math.max(0,p.life-dt)});particles=particles.filter(p=>p.life>0);
        const near=nearest(),touch=compactScreen.matches||touchScreen.matches;
        $('scanHint').classList.toggle('in-range',!!near&&near.d<RANGE);$('scanHintText').textContent=near&&near.d<RANGE?'发现'+traffic[near.t.type].name+(touch?' · 点击扫描':' · 按空格扫描'):touch?'靠近标记 · 点击扫描':'靠近橙色标记，发现交通问题';
      }
    }else if(mode==='ready'&&!document.hidden)cityTime+=dt*.4;
    uiTick+=dt;if(uiTick>.09){uiTick=0;updateTimer()}
    nearbyTick+=dt;if(nearbyTick>.45){nearbyTick=0;updateNearby()}
    if(!document.hidden)drawScene();
    requestAnimationFrame(frame);
  }
  function updateTimer(){$('timeValue').textContent=String(Math.ceil(remaining)).padStart(2,'0');$('mobileTime').textContent=Math.ceil(remaining);$('timeBar').style.transform='scaleX('+Math.max(0,remaining/DURATION)+')';document.querySelector('.time-track').classList.toggle('urgent',remaining<=10);document.querySelector('.time-number').classList.toggle('urgent',remaining<=10);$('boostButton').classList.toggle('is-boosting',boost||keys.has('boost'));$('boostButton').setAttribute('aria-pressed',String(boost||keys.has('boost')))}
  // Read-only probe lets browser verification inspect real state without altering gameplay.
  Object.defineProperty(window,'__CITY_PATROL__',{value:Object.freeze({worldImage:()=>staticLayer.toDataURL('image/png'),layout:()=>({roads:roadAreas.map(r=>({...r})),structures:cityStructures.map(r=>({...r})),amenities:cityAmenities.map(r=>({...r}))}),snapshot:()=>({mode,remaining,score,caught,cityTime,drone:{...drone},world:{width:W,height:H,area:W*H},camera:{...camera},visited:[...visited],districts:districts.map(d=>({...d})),events:eventTypes.map(type=>({type,name:traffic[type].name,group:traffic[type].group})),targets:targets.map(t=>({...t})),viewport:{sx,sy,width:cssW,height:cssH}})}),writable:false});
  let resizeRequest=0;
  function scheduleResize(){if(!resizeRequest)resizeRequest=requestAnimationFrame(()=>{resizeRequest=0;resize()})}
  window.addEventListener('resize',scheduleResize);window.visualViewport?.addEventListener('resize',scheduleResize);
  reset();makeCity();new ResizeObserver(scheduleResize).observe(stage);resize();last=performance.now();requestAnimationFrame(frame);
})();
