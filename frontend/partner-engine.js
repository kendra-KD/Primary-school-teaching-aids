/* =====================================================================
   伙伴互动引擎（共享模块：老师大屏 + 学生端共用，单一来源，避免双份漂移）
   让预渲染的静态伙伴形象"活"起来（纯前端，无第三方依赖）：
   - ding：Web Audio 简单"叮"音效（进化/绽放/点赞/负向/戳/挠）
   - reactPartner：戳 / 摸摸头 / 逗它玩 / 抱抱（果冻·挤压·旋转 + 粒子 + 气泡 + 音效 + 真表情帧）
   - makeDraggable：按住拖走、松手弹性回弹（汤姆猫式手感）；轻点 = onTap（默认戳一戳）
   - startBlink / stopBlink：待机眨眼（说话气泡在时不抢戏）
   - swapFrame / preloadFrames：切真表情帧并自动还原
   - spawnFx / sayBubble / playAnim：粒子、台词气泡、transform 动画
   - startAmbient：大屏整面墙随机轻动（无 .partner 容器时自动空转）
   台词全部正向，符合教育红线（不出现负面评价）。
   配套样式见 partner-engine.css。
   ===================================================================== */
let actx=null;
function ding(kind){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    const o=actx.createOscillator(), g=actx.createGain();
    o.connect(g); g.connect(actx.destination);
    let f=523.25, dur=.6, type='sine';
    if(kind==='bloom'){f=880;dur=.7;}
    else if(kind==='evolve'){f=660;dur=.8;type='triangle';}
    else if(kind==='love'){f=784;dur=.7;}
    else if(kind==='neg'){f=233;dur=.5;type='sine';}
    else if(kind==='poke'){f=1046.5;dur=.24;type='triangle';}
    else if(kind==='tickle'){f=1318.5;dur=.3;type='sine';}
    o.type=type; o.frequency.value=f;
    g.gain.setValueAtTime(.0001,actx.currentTime);
    g.gain.exponentialRampToValueAtTime(.22,actx.currentTime+.02);
    g.gain.exponentialRampToValueAtTime(.0001,actx.currentTime+dur);
    o.start(); o.stop(actx.currentTime+dur+.02);
  }catch(e){}
}

const REACT_LINES={
  touch:['咕噜噜～好舒服','再摸摸头嘛～','嘿嘿，有点痒呀','谢谢你摸我！'],
  play:['哈哈，我还要玩！','看我的转圈圈～','耶！好开心 ✨','再来一次好不好'],
  hug:['谢谢你抱抱我 💗','被抱住啦，好暖～','我记住你啦！','抱一抱，能量满格 ⚡'],
  poke:['嘿嘿，被摸到啦～','我今天又长大一点点！','老师好呀 🌞','我会继续加油的 ✨','咕噜～好痒哦','我要长成最亮的星星 ⭐']
};
const FX_EMOJI=['💗','✨','⭐','🌸','🍀','🎈','💫','🌈'];
function randOf(a){ return a[Math.floor(Math.random()*a.length)]; }

/* 素材自带 10 个表情帧（normal/loving/crying/surprised/happy/blinking/talking/waving/thinking/sleeping），
   前端原先只用 4 个。这里把剩下的用起来：反应时切真表情（大笑/挥手/眨眼），而不是干晃一下。 */
const EXTRA_FRAMES=['happy','blinking','talking','waving','surprised','loving'];
const __preloaded={};
function preloadFrames(img){
  if(!img) return;
  const base=img.getAttribute('src'); if(!base) return;
  const stem=base.replace(/_[a-z]+\.png$/,'');
  if(__preloaded[stem]) return; __preloaded[stem]=1;
  EXTRA_FRAMES.forEach(f=>{ const i=new Image(); i.src=stem+'_'+f+'.png'; });
}
function swapFrame(img, frame, hold){
  if(!img) return;
  const cur=img.getAttribute('src')||'';
  if(!img.__base) img.__base=cur;
  img.setAttribute('src', img.__base.replace(/_[a-z]+\.png$/,'_'+frame+'.png'));
  clearTimeout(img.__ft);
  img.__ft=setTimeout(()=>{ if(img.__base && document.body.contains(img)) img.setAttribute('src', img.__base); }, hold||900);
}
let __blinkT=null;
function startBlink(stage){
  stopBlink();
  __blinkT=setInterval(()=>{
    if(document.hidden) return;
    if(!document.body.contains(stage)){ stopBlink(); return; }
    if(stage.querySelector('.gbubble')) return;      // 正在说话时不抢戏
    swapFrame(stage.querySelector('.pimg'), 'blinking', 190);
  }, 4200);
}
function stopBlink(){ if(__blinkT){ clearInterval(__blinkT); __blinkT=null; } }

function spawnFx(stage, n, emoji){
  if(!stage) return;
  n=n||6;
  for(let i=0;i<n;i++){
    const s=document.createElement('span');
    s.className='pfx';
    s.textContent = emoji || randOf(FX_EMOJI);
    s.style.setProperty('--dx', (Math.random()*130-65).toFixed(0)+'px');
    s.style.setProperty('--dy', (-70-Math.random()*80).toFixed(0)+'px');
    s.style.setProperty('--rot', (Math.random()*140-70).toFixed(0)+'deg');
    s.style.fontSize = (16+Math.random()*14).toFixed(0)+'px';
    s.style.animationDelay = (i*55)+'ms';
    stage.appendChild(s);
    setTimeout(()=>{ if(s.parentNode) s.parentNode.removeChild(s); }, 1500+i*55);
  }
}
function sayBubble(stage, text){
  if(!stage) return;
  const old=stage.querySelector('.gbubble'); if(old&&old.parentNode) old.parentNode.removeChild(old);
  const b=document.createElement('div');
  b.className='gbubble';
  b.textContent=text||randOf(REACT_LINES.poke);
  stage.appendChild(b);
  setTimeout(()=>{ if(b.parentNode) b.parentNode.removeChild(b); }, 2400);
}
function playAnim(img, cls, ms){
  if(!img) return;
  img.classList.remove('poke','hug','spin2','hop');
  void img.offsetWidth;
  img.classList.add(cls);
  setTimeout(()=>img.classList.remove(cls), ms||1200);
}
function reactPartner(stage, kind){
  if(!stage) return;
  const img=stage.querySelector('.pimg');
  const C={
    touch:{cls:'poke', ms:700,  n:5,  emoji:'💗', sound:'poke',   lines:REACT_LINES.touch,   frame:'happy'},
    play: {cls:'spin2',ms:1000, n:9,  emoji:'✨', sound:'tickle', lines:REACT_LINES.play,    frame:'waving'},
    hug:  {cls:'hug',  ms:1100, n:11, emoji:'💗', sound:'love',   lines:REACT_LINES.hug,     frame:'happy'},
    poke: {cls:'poke', ms:700,  n:6,  emoji:null, sound:'poke',   lines:REACT_LINES.poke,    frame:'surprised'}
  };
  const cfg=C[kind]||C.poke;
  playAnim(img, cfg.cls, cfg.ms);
  swapFrame(img, cfg.frame, cfg.ms);          // 切真表情帧：惊/笑/挥手，而不是干晃
  spawnFx(stage, cfg.n, cfg.emoji);
  sayBubble(stage, randOf(cfg.lines));
  ding(cfg.sound);
  try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
  const hint=stage.querySelector('.gpoke-hint'); if(hint) hint.style.opacity='0';
}
function makeDraggable(stage, opts){
  if(!stage || stage.__drag) return;
  stage.__drag=true;
  stage.classList.add('pokable');
  let sx=0, sy=0, dx=0, dy=0, down=false, moved=false;
  const img=stage.querySelector('.pimg');
  const pt=e=>{ const t=e.touches&&e.touches[0]; return t||e; };
  const onDown=e=>{
    if(e.button!=null && e.button!==0) return;
    const p=pt(e); sx=p.clientX; sy=p.clientY; down=true; moved=false;
    if(img){ img.style.animation='none'; img.style.transition='none'; }
    stage.classList.add('dragging');
    try{ stage.setPointerCapture(e.pointerId); }catch(err){}   // 捕获指针：拖出边界也不丢
  };
  const onMove=e=>{
    if(!down) return;
    const p=pt(e); dx=p.clientX-sx; dy=p.clientY-sy;
    if(!moved && (Math.abs(dx)>6||Math.abs(dy)>6)) moved=true;
    if(moved && img){
      img.style.transform='translate('+dx.toFixed(0)+'px,'+dy.toFixed(0)+'px) rotate('+(dx*0.05).toFixed(1)+'deg)';
      if(e.cancelable) e.preventDefault();
    }
  };
  const onUp=()=>{
    if(!down) return;
    down=false; stage.classList.remove('dragging');
    if(moved && img){
      img.style.transition='transform .6s cubic-bezier(.34,1.56,.64,1)';
      img.style.transform='';
      setTimeout(()=>{ img.style.transition=''; img.style.transform=''; img.style.animation=''; }, 660);
    }else{
      if(img){ img.style.transition=''; img.style.transform=''; img.style.animation=''; }
      if(opts && opts.onTap) opts.onTap(); else reactPartner(stage,'poke');
    }
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove, {passive:false});
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
}
/* 大屏待机：每隔一阵随机一个小伙伴轻轻动一下，整面墙"活着"；学生端无 .partner 时自动空转 */
function startAmbient(){
  if(window.__gpAmbient) return; window.__gpAmbient=true;
  setInterval(()=>{
    if(document.hidden) return;
    if(document.querySelector('#overlay.show')) return;   // 成长卡打开时不打扰
    const imgs=document.querySelectorAll('.partner .blob .pimg');
    if(!imgs.length) return;
    const img=imgs[Math.floor(Math.random()*imgs.length)];
    playAnim(img,'hop',600);
    const blob=img.closest('.blob');
    if(blob) spawnFx(blob,2,null);
  },7000);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', startAmbient);
else startAmbient();
