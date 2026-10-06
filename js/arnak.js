import {scenes, details, chapters} from './arnak-content.js';
const $ = selector => document.querySelector(selector);
const names = {board:'鸟神庙主板',research:'原版研究轨道', 'player-board':'玩家板',funding:'资金牌',exploration:'探索牌',fear:'恐惧牌',guardian:'守护者',site:'遗址',assistant:'银面助手',item:'驮驴物品牌',artifact:'蛇之黄金神器牌',idols:'神像',coin:'钱币',compass:'罗盘',tablet:'石板',arrowhead:'箭头',jewel:'宝石','moon-staff':'月杖',archaeologists:'考古学家'};
const art = (name, cls='') => `<img class="${cls}" src="assets/arnak/${name}.webp" alt="${names[name]}">`;
const component = (name, label=names[name], cls='') => `<div class="exp-component ${cls}">${art(name)}<span>${label}</span></div>`;
const chip = (text, cls='') => `<span class="exp-chip ${cls}">${text}</span>`;
const crew = '<svg class="exp-crew" viewBox="0 0 48 60" role="img" aria-label="一名考古学家的移动示意"><path fill="currentColor" d="M14 5h20v8h6v6H8v-6h6zM17 23h14l10 14-8 5-4-6v19H19V36l-4 6-8-5z"/></svg>';
let current=0, beat=0, timer, paused=false, inDetails=false;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const numerals=['一','二','三','四','五','六'];
$('#chapterNav').innerHTML=chapters.map((name,ch)=>`<section class="chapter-group"><h2>${numerals[ch]} · ${name}</h2>${ch<5?scenes.map((s,i)=>s.chapter===ch?`<button type="button" data-scene="${i}">${s.title}</button>`:'').join(''):'<button type="button" data-detail="">探险笔记</button>'}</section>`).join('');
$('#detailList').innerHTML=details.map(([id,title,text])=>`<details id="detail-${id}"><summary>${title}</summary><p>${text}</p></details>`).join('');

function draw() {
  const s=scenes[current], mode=s.visual.mode, frame=$('#stageVisual');
  frame.dataset.mode=mode;frame.dataset.beat=beat;
  let content='';
  const steps=(labels)=>`<div class="exp-flow">${labels.map((l,i)=>chip(l,`${i===beat?'is-current':''} ${i<beat?'is-complete':''}`)).join('<span class="exp-arrow" aria-hidden="true">→</span>')}</div>`;
  const gallery=(items)=>`<div class="exp-gallery">${items.map(([name,label,cls])=>component(name,label,cls||'')).join('')}</div>`;
  if(mode==='island') content=`<div class="exp-island">${art('board','exp-board')}<div class="exp-island-notes"><span class="exp-overline">LOST RUINS OF ARNAK</span><strong>${beat===0?'登岛':beat===1?'五轮':'归航'}</strong><p>探索 · 构筑 · 研究</p><div class="exp-rounds">${[1,2,3,4,5].map(n=>chip(`0${n}`,beat===1?'is-current':'')).join('')}</div><small>你的考古队 · 另外三支队伍</small></div></div>`;
  if(mode==='setup-map') content=`<div class="exp-map-layout">${art('board','exp-board')}<div class="exp-map-notes">${['基础遗址 · 5 处，四人全开放','研究轨道 · 按四人标记放奖励','市场首轮 · 1 神器 + 5 物品'].map((t,i)=>chip(t,i===beat?'is-current':'')).join('')}${art('moon-staff','exp-staff')}</div></div>`;
  if(mode==='resources') content=`<div class="exp-resource-grid">${['coin','compass','tablet','arrowhead','jewel'].map((n,i)=>component(n,names[n],(beat===0?i<2:beat===1?i>=2:true)?'is-lit':'')).join('')}</div><p class="exp-note">${['钱币买物品；罗盘发现与找神器','石板 · 箭头 · 宝石，各按图标支付','五类资源可跨轮保留'][beat]}</p>`;
  if(mode==='camp') content=`${art('player-board','exp-player-board')}<div class="exp-camp">${beat===0?gallery([['archaeologists','每队 2 名'],['research','放大镜 / 笔记本起点']]):beat===1?gallery([['funding','资金 ×2'],['exploration','探索 ×2'],['fear','恐惧 ×2']]):`<div class="exp-seats">${['甲｜2 钱','乙｜1 钱 1 罗盘','丙｜2 钱 1 罗盘','你｜1 钱 2 罗盘'].map(t=>chip(t)).join('')}</div>`}</div>`;
  if(mode==='supply') content=gallery(beat===0?[['assistant','银面 · 3 堆 × 4 枚']]:beat===1?[['site','遗址按等级成堆'],['guardian','守护者成堆'],['idols','一级 1 枚 · 二级 2 枚']]:[['player-board','准备完成'],['board','四队开始探险']]);
  if(mode==='turn') content=`<div class="exp-action-grid">${['挖掘','发现','克服守护者','买牌','打牌效果','研究'].map((t,i)=>chip(t,i===beat?'is-current':'')).join('')}</div>${steps(['免费行动','一个主行动','免费行动'])}<p class="exp-note">自己的回合结束，顺时针交给下一队。</p>`;
  if(mode==='card') content=`<div class="exp-card-demo">${art('funding','exp-card')}<div class="exp-card-path"><div class="${beat===1?'is-current':''}"><b>效果</b>${art('coin')}<span>1 钱币 · 免费行动</span></div><span class="exp-or">或者</span><div class="${beat===2?'is-current':''}"><b>旅行</b><strong>汽车</strong><span>不执行卡牌正文</span></div></div></div><p class="exp-note">两条路径是互斥示例，不是重复使用同一张牌。</p>`;
  if(mode==='dig'||mode==='discover') content=`<div class="exp-expedition"><div class="exp-origin">${art('player-board')}<span>你的营地</span></div><div class="exp-route"><span class="exp-arrow">→</span>${chip(mode==='discover'?'3／6 罗盘 + 旅行':'格位旅行费用',beat===0?'is-current':'')}</div><div class="exp-site">${art('site')}${beat>0?crew:''}${mode==='discover'&&beat===2?art('guardian','exp-awakened'):''}<span>${mode==='discover'?'未知位置 → 新遗址':'已开放遗址'}</span></div></div>${gallery(beat===2?(mode==='discover'?[['idols','先获得神像奖励'],['guardian','最后放守护者']]:[['tablet','按遗址图标获得资源']]):[])}<p class="exp-note">${mode==='discover'?'原版配件与示意队员；具体旅行及效果按实际翻开的配件。':'示意队员来自玩家板，通常停留到轮末；资源按实际遗址图标。'}</p>`;
  if(mode==='travel') content=`<div class="exp-travel-grid">${['飞机 → 任意图标','汽车 → 汽车 / 靴子','船 → 船 / 靴子','靴子 → 靴子'].map((t,i)=>chip(t,(beat===0?i===0:beat===1?i===1||i===2:i===3)?'is-current':'')).join('')}</div>${gallery([['fear','恐惧牌也有靴子'],['coin','2 钱币可雇飞行员']])}`;
  if(mode==='guardian') content=`<div class="exp-guardian-demo">${art('site','exp-site-card')}${art('guardian',`exp-guardian ${beat===2?'is-overcome':''}`)}</div>${steps(['不封格','付底部费用','带回 · 5 分'])}<p class="exp-note">${beat===2?'祝福只用一次，翻面后仍然值 5 分。':'克服需有自己的队员在该遗址；轮末仍在场才会带来恐惧。'}</p>`;
  if(mode==='idol') content=`${component('idols','发现后，先放在补给箱')}<div class="exp-idol-slots">${[1,2,3,4].map((n,i)=>`<div class="${beat>0&&i===0?'is-filled':''}"><b>${beat>0&&i===0?'神像':`+${n}`}</b><small>${beat>0&&i===0?'仍值 3 分':'空槽分'}</small></div>`).join('')}</div><p class="exp-note">${beat===0?'每枚神像本身值 3 分。':'放最左空槽，换一次效果；放弃该槽空置分。'}</p>`;
  if(mode==='item'||mode==='artifact') {const item=mode==='item';content=`<div class="exp-purchase">${art(item?'item':'artifact','exp-card')}<div class="exp-purchase-path">${component(item?'coin':'compass',item?'4 钱币':'3 罗盘')}<span class="exp-arrow">→</span><div class="exp-destination ${beat>0?'is-current':''}"><b>${item?'牌库底':'打出区'}</b><span>${item?'面朝下，之后抽到才使用':'可立即发动 · 首次免角落石板'}</span></div></div></div>${beat===2&&!item?`<p class="exp-note">下次从手里发动：1 石板 + 正文的其他成本。</p>`:steps(item?['付钱币','放牌库底','回合末补物品']:['付罗盘','可立即发动','回合末补神器'])}`;}
  if(mode==='research'||mode==='temple') content=`<div class="exp-research-layout">${art('research','exp-research-board')}<div class="exp-research-notes">${(mode==='research'?['支付桥上费用','放大镜先发现','笔记本不超过放大镜']:['放大镜登顶','笔记本停在下方','之后研究可买神庙板块']).map((t,i)=>chip(t,i===beat?'is-current':'')).join('')}<div class="exp-research-markers"><span class="exp-lens" style="--advance:${beat}" aria-label="放大镜示意">⌕</span><span class="exp-notebook" style="--advance:${Math.max(0,beat-1)}" aria-label="笔记本示意">▤</span></div><small>标记形状与位置为教学示意</small></div></div>`;
  if(mode==='assistant') content=`<div class="exp-assistant-demo">${art('assistant',`exp-assistant ${beat===1?'is-exhausted':''}`)}<div><strong>${['银面','横置','金面升级'][beat]}</strong><p>${['研究行效果招募','本轮已使用','翻面，同时恢复可用'][beat]}</p>${beat===2?chip('升级效果示意；图中仍展示原版银面'):''}</div></div>`;
  if(mode==='pass') content=`<div class="exp-seats">${['甲','乙','丙','你'].map((t,i)=>chip(`${t} · ${i===3||beat===2?'已结束':'继续行动'}`,i===3?'is-current':'')).join('')}</div>${art('player-board','exp-player-board')}<p class="exp-note">已结束的队伍跳过；其他队伍仍可继续自己的回合。</p>`;
  if(mode==='return') content=gallery(beat===0?[['archaeologists','队员回营地'],['fear','若遗址仍有守护者，拿恐惧']]:beat===1?[['funding','打出区洗匀'],['player-board','放到剩余牌库底']]:[['assistant','助手恢复'],['coin','资源保留'],['idols','成果保留']]);
  if(mode==='moon') content=`<div class="exp-market-rounds">${[1,2,3,4,5].map((n,i)=>`<div class="${i===beat?'is-current':''}"><b>${['I','II','III','IV','V'][i]}</b><span>${n} 神器</span><small>${6-n} 物品</small>${i===beat?art('moon-staff'):''}</div>`).join('')}</div><p class="exp-note">图示五轮市场比例；${['先放逐月杖左右紧邻两张','移杖、补市场、先手左传','每轮开始手牌补到五张'][beat]}</p>`;
  if(mode==='score') content=`<div class="exp-score-sheet">${[['研究与神庙','标记位置 + 板块'],['神像与空槽','3 / 枚 + 空槽分'],['守护者','5 / 枚'],['物品与神器','右下角分数'],['恐惧','牌 −1 · 板块 −2']].map(([a,b],i)=>`<div class="${beat===0?i===0?'is-current':'':beat===1?i>0&&i<4?'is-current':'':i===4?'is-current':''}"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`;
  frame.innerHTML=`<div class="exp-state">${s.visual.states[beat]}</div><div class="exp-table">${content}</div><div class="exp-beat-track" aria-hidden="true">${s.beats.map((_,i)=>`<i class="${i<=beat?'is-active':''}"></i>`).join('')}</div>`;
  $('#stageStatus').textContent=`${beat+1} / ${s.beats.length}`;
  document.querySelectorAll('.narration-beat').forEach((el,i)=>{el.classList.toggle('is-active',i===beat);el.classList.toggle('is-past',i<beat);});
}
function stop(){clearTimeout(timer);$('#stageVisual').querySelectorAll('*').forEach(el=>el.style.animationPlayState='paused');}
function sync(){const done=beat===scenes[current].beats.length-1;$('#pause').textContent=reduced.matches?'下一步演示':paused?'继续动画':'暂停动画';$('#pause').disabled=done;$('#animationStatus').textContent=done?'本幕演示结束':reduced.matches?'静态演示':paused?'已暂停':'演示中';}
function schedule(){clearTimeout(timer);if(!paused&&!inDetails&&!reduced.matches&&beat<scenes[current].beats.length-1)timer=setTimeout(()=>{beat++;draw();schedule();},8500);sync();}
function render(focus=false){
  stop();inDetails=false;paused=false;beat=reduced.matches?scenes[current].beats.length-1:0;
  const s=scenes[current];$('#lesson').hidden=false;$('#detailPanel').hidden=true;
  $('#chapterLabel').textContent=`第${numerals[s.chapter]}章 / ${chapters[s.chapter]}`;$('#sceneCount').textContent=`${String(current+1).padStart(2,'0')} / ${scenes.length}`;
  $('#lessonTitle').textContent=s.title;$('#scenePrelude').textContent=s.prelude;$('#sceneText').innerHTML=s.beats.map((text,i)=>`<div class="narration-beat"><span>${String(i+1).padStart(2,'0')}</span><p>${text}</p></div>`).join('');
  $('#takeaway').textContent=s.takeaway;$('#stageLabel').textContent='探险桌面 · 分步讲演';$('#stageCaption').textContent='原版配件 · 位置与移动为教学示意';$('#relatedDetail').hidden=!s.detail;
  $('#previous').disabled=current===0;$('#next').textContent=current===scenes.length-1?'前往细节查阅 →':'下一幕 →';
  document.querySelectorAll('[data-scene], [data-detail]').forEach(el=>el.toggleAttribute('aria-current',el.hasAttribute('data-scene')&&Number(el.dataset.scene)===current));
  draw();schedule();if(focus)$('#lessonTitle').focus({preventScroll:true});
}
function navigate(i){current=Math.max(0,Math.min(scenes.length-1,i));history.replaceState(null,'',`#${scenes[current].id}`);render(true);}
function showDetails(id='',focus=true){stop();inDetails=true;$('#lesson').hidden=true;$('#detailPanel').hidden=false;history.replaceState(null,'',`#details${id?'/'+id:''}`);document.querySelectorAll('[data-scene], [data-detail]').forEach(el=>el.toggleAttribute('aria-current',el.hasAttribute('data-detail')));if(id){const el=document.getElementById(`detail-${id}`);if(el){el.open=true;el.scrollIntoView({block:'center'});}}if(focus)$('#detailTitle').focus({preventScroll:true});}
$('#chapterNav').addEventListener('click',e=>{const b=e.target.closest('button');if(b)b.hasAttribute('data-scene')?navigate(Number(b.dataset.scene)):showDetails();});
$('#previous').onclick=()=>navigate(current-1);$('#next').onclick=()=>current===scenes.length-1?showDetails():navigate(current+1);
$('#replay').onclick=()=>{stop();beat=0;paused=false;draw();schedule();};
$('#pause').onclick=()=>{if(reduced.matches){beat=Math.min(beat+1,scenes[current].beats.length-1);draw();sync();return;}paused=!paused;$('#stageVisual').querySelectorAll('*').forEach(el=>el.style.animationPlayState=paused?'paused':'running');paused?stop():schedule();sync();};
$('#relatedDetail').onclick=()=>showDetails(scenes[current].detail);$('#returnLesson').onclick=()=>navigate(current);
function fromHash(){const hash=decodeURIComponent(location.hash.slice(1)),i=scenes.findIndex(s=>s.id===hash);if(i>=0)current=i;render();if(hash.startsWith('details'))showDetails(hash.split('/')[1]||'',false);}
window.addEventListener('hashchange',fromHash);reduced.addEventListener('change',()=>{if(!inDetails)render();});document.addEventListener('visibilitychange',()=>{if(document.hidden){paused=true;stop();sync();}});window.addEventListener('pagehide',stop);fromHash();
