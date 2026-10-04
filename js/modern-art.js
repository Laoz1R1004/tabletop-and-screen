import {scenes, details, artists, artTypes} from './modern-art-content.js';
const $ = selector => document.querySelector(selector);
const asset = (name, cls = '', alt = '') => `<img class="${cls}" src="assets/modern-art/${name}.webp" alt="${alt}">`;
const method = {open:'公开拍卖', once:'一次出价', hidden:'暗拍', fixed:'一口价', double:'双重拍卖'};
const chapterNames = ['准备开馆', '拍卖开始', '细节查阅'];
let current = 0, beat = 0, timer, paused = false, inDetails = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

$('#chapterNav').innerHTML = chapterNames.map((name, chapter) => `<section class="chapter-group"><h2>${['一','二','三'][chapter]} · ${name}</h2>${chapter < 2 ? scenes.map((s,i) => s.chapter === chapter ? `<button type="button" data-scene="${i}">${s.title.split(' · ')[0]}</button>` : '').join('') : '<button type="button" data-detail="">拍卖师的提醒</button>'}</section>`).join('');
$('#detailList').innerHTML = details.map(([id, title, text]) => `<details id="detail-${id}"><summary>${title}</summary><p>${text}</p></details>`).join('');

function museums(config) {
  const dealer = config.mode === 'self' ? 0 : 1;
  const bidder = config.bids?.[Math.min(beat, config.bids.length-1)];
  return ['你','馆长甲','馆长乙','馆长丙'].map((name,i) => {
    const amount = config.mode === 'finale' ? [168,142,131,155][i] : config.mode === 'setup' && beat > 0 ? 100 : null;
    const bid = config.mode === 'auction' && (config.type === 'hidden' ? beat > 0 ? config.bids.find(b => b.seat === i) : {value:'藏好'} : bidder?.seat === i ? bidder : null);
    return `<div class="museum museum--${i}${bid ? ' is-bid' : ''}">${asset('screen', '', '博物馆屏风')}<b>${name}</b><small>${amount !== null ? `资金 ${amount}` : config.mode === 'setup' ? '9 张手牌' : '资金保密'}</small>${bid ? `<span class="bid-bubble">${bid.value}</span>` : ''}${i === dealer && !['welcome','goal','finale','value','market','ranking','settlement','new-round'].includes(config.mode) ? asset('hammer','hammer','当前拍卖者') : ''}</div>`;
  }).join('');
}
function visual(config) {
  const mode = config.mode;
  const frame = $('#stageVisual');
  frame.dataset.mode = mode;
  frame.className = `stage-visual${['market','ranking','value','new-round','finale'].includes(mode) ? ' market-view' : ''}`;
  let center = '', extra = '';
  if (mode === 'welcome') center = `<div class="card-fan">${artTypes.map((t,i) => asset(t,'painting',`${artists[i]} 原版画作牌`)).join('')}</div><span class="auction-method">MODERN ART · 四人拍卖厅</span>`;
  if (mode === 'goal') center = `${asset('board','board-image','市场板')}<span class="auction-method">第 ${Math.min(beat+1,3)} 轮${beat===2 ? ' → 第 4 轮' : ''} · 拍卖与结算</span>`;
  if (mode === 'components') center = `<div class="component-layout">${asset('board','board-image','原版市场板')}${asset(beat===0?'open':beat===1?'values':'money','',beat===1?'价值标记':'原版配件')}</div>`;
  if (mode === 'setup') center = `${asset('board','board-image','市场板')}<span class="auction-method">${['每人发 9 张手牌','每人 100 资金，放到屏风后','甲拿拍卖槌，首次拍卖开始'][beat]}</span>`;
  if (mode === 'ownership') {
    center = `<div class="hand-stack">${Array.from({length:9},()=>'<i aria-hidden="true"></i>').join('')}</div><span class="auction-method">待售手牌 · 尚未购入</span>`;
    if (beat > 0) extra = asset('open','owned-painting','示意：你已购入的作品');
  }
  if (['trade','self','auction'].includes(mode)) {
    center = `${asset(config.type,'painting',`${method[config.type]} 原版画作牌`)}<span class="auction-method">${method[config.type]}${config.type==='fixed'?' · 固定价格 18':''}${mode==='self'?' · 你主持拍卖':''}</span>`;
    if (mode==='auction' && beat===2) {
      center = `<span class="auction-method">${method[config.type]} · 你以 ${config.price} 买入</span>`;
      extra = asset(config.type,'owned-painting','成交后，作品进入你的博物馆') + `<div class="trade-money">${asset('money','','付款给馆长甲')}<b>${config.price}</b></div>`;
    }
    if (beat===2 && mode!=='auction') {
      center = `<span class="auction-method">${mode==='self'?'银行收款':'甲收到画款'} · ${config.price}</span>`;
      extra += asset(config.type,'owned-painting','你买到的作品');
    }
    if (beat > 0 && mode!=='auction') extra += `<div class="trade-money${mode==='self'?' to-bank':''}">${asset('money','', '付款示意')}<b>${config.price}</b></div>`;
  }
  if (mode==='double') center = `<div class="component-layout">${asset('double','painting','Rafael 双重拍卖牌')}<div class="second-painting">${asset('double','painting','同艺术家第二幅画的示意')}<span>同艺术家<br>非双重牌</span></div></div><span class="auction-method">${['第一张：双重拍卖','第二张：决定拍卖方式','两张合卖 · 示例总价 24'][beat]}</span>`;
  if (mode==='market' || mode==='ranking') center = `<div class="market-columns">${artists.map((a,i) => `<div class="market-column">${asset(artTypes[i],'',a)}<span>${a}</span><b>${config.counts[i]}</b><small>张已打出</small>${mode==='ranking' && beat>0 ? `<span class="value-tile${!config.values[i]?' is-zero':''}">${config.values[i]}</span>` : ''}</div>`).join('')}</div><span class="auction-method">${mode==='market' ? '第五张：只计数，不拍卖' : '本轮排名 → 本轮新增价值'}</span>`;
  if (mode==='settlement') center = `<div class="component-layout">${asset('double','painting','Rafael 作品示意')}${asset('double','painting','第二幅 Rafael 作品示意')}</div><div class="value-equation">2 × 30 = 60<small>银行 → 你的资金</small></div>`;
  if (mode==='new-round') center = `<div class="deal-schedule">${[9,4,4,0].map((v,i)=>`<div><b>${v}</b><small>第${i+1}轮新增</small></div>`).join('')}</div>${asset('board','board-image','保留此前价值标记的市场板示意')}`;
  if (mode==='value') center = `${asset('double','painting','Rafael 作品示意')}<div class="value-equation">${['30 + 10 = 40','30 + 10 = 40','未入前三 = 0<br>重回前三：30 + 10 + 20 = 60'][beat]}<small>本轮前三，才可累计历史价值</small></div>`;
  if (mode==='finale') center = `<span class="auction-method">四轮结束 · 你的最终资金</span><strong class="final-money">168</strong><span>资金最多，获胜。</span>`;
  frame.innerHTML = museums(config) + `<div class="auction-center">${center}</div>` + extra;
  $('#stageStatus').textContent = `${beat+1} / ${scenes[current].beats.length}`;
  document.querySelectorAll('.narration-beat').forEach((el,i)=>{el.classList.toggle('is-active',i===beat);el.classList.toggle('is-past',i<beat);});
}
function stop() { clearTimeout(timer); $('#stageVisual').querySelectorAll('*').forEach(el=>el.style.animationPlayState='paused'); }
function schedule() {
  clearTimeout(timer);
  if (paused || inDetails || reduced.matches || beat >= scenes[current].beats.length-1) { syncControls(); return; }
  timer = setTimeout(()=>{beat++;visual(scenes[current].visual);schedule();},6500);
  syncControls();
}
function syncControls() {
  const finished = beat === scenes[current].beats.length-1;
  $('#pause').textContent = reduced.matches ? '下一步演示' : paused ? '继续动画' : '暂停动画';
  $('#pause').disabled = finished;
  $('#animationStatus').textContent = finished ? '本幕演示结束' : reduced.matches ? '静态演示' : paused ? '已暂停' : '演示中';
}
function render(focus = false) {
  stop(); inDetails = false; paused = false; beat = reduced.matches ? scenes[current].beats.length-1 : 0;
  const s = scenes[current];
  $('#lesson').hidden = false; $('#detailPanel').hidden = true;
  $('#chapterLabel').textContent = `第${s.chapter===0?'一':'二'}章 / ${chapterNames[s.chapter]}`;
  $('#sceneCount').textContent = `${String(current+1).padStart(2,'0')} / ${scenes.length}`;
  $('#lessonTitle').textContent = s.title; $('#scenePrelude').textContent = s.prelude;
  $('#sceneText').innerHTML = s.beats.map((text,i)=>`<div class="narration-beat"><span>${String(i+1).padStart(2,'0')}</span><p>${text}</p></div>`).join('');
  $('#takeaway').textContent = s.takeaway;
  $('#stageLabel').textContent = s.chapter===0?'开馆准备':'拍卖厅 · 教学演示'; $('#stageCaption').textContent = s.visual.caption;
  $('#relatedDetail').hidden = !s.detail;
  $('#previous').disabled = current===0;
  $('#next').textContent = current===scenes.length-1 ? '前往细节查阅 →' : '下一幕 →';
  document.querySelectorAll('[data-scene], [data-detail]').forEach(el=>el.toggleAttribute('aria-current',Number(el.dataset.scene)===current && el.hasAttribute('data-scene')));
  visual(s.visual);schedule();
  if (focus) $('#lessonTitle').focus({preventScroll:true});
}
function navigate(index, focus = true) {
  current = Math.max(0,Math.min(scenes.length-1,index));
  history.replaceState(null,'',`#${scenes[current].id}`);render(focus);
}
function showDetails(id = '', focus = true) {
  stop(); inDetails=true;
  $('#lesson').hidden=true; $('#detailPanel').hidden=false;
  history.replaceState(null,'',`#details${id?'/'+id:''}`);
  document.querySelectorAll('[data-scene], [data-detail]').forEach(el=>el.toggleAttribute('aria-current',el.hasAttribute('data-detail')));
  if (id) { const el = document.getElementById(`detail-${id}`); if (el) {el.open=true;el.scrollIntoView({block:'center'});} }
  if (focus) $('#detailTitle').focus({preventScroll:true});
}
$('#chapterNav').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;b.hasAttribute('data-scene') ? navigate(Number(b.dataset.scene)) : showDetails();});
$('#previous').onclick=()=>navigate(current-1);
$('#next').onclick=()=>current===scenes.length-1 ? showDetails() : navigate(current+1);
$('#replay').onclick=()=>{stop();beat=0;paused=false;visual(scenes[current].visual);schedule();};
$('#pause').onclick=()=>{
  if(reduced.matches) {beat=Math.min(beat+1,scenes[current].beats.length-1);visual(scenes[current].visual);syncControls();return;}
  paused=!paused;
  $('#stageVisual').querySelectorAll('*').forEach(el=>el.style.animationPlayState=paused?'paused':'running');
  paused ? stop() : schedule();syncControls();
};
$('#relatedDetail').onclick=()=>showDetails(scenes[current].detail);
$('#returnLesson').onclick=()=>navigate(current);
function fromHash() {
  const hash=decodeURIComponent(location.hash.slice(1));
  const i=scenes.findIndex(s=>s.id===hash);
  if(i>=0)current=i;
  render();if(hash.startsWith('details'))showDetails(hash.split('/')[1]||'',false);
}
window.addEventListener('hashchange',fromHash);
reduced.addEventListener('change',()=>{if(!inDetails)render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){paused=true;stop();syncControls();}});
window.addEventListener('pagehide',stop);
fromHash();
