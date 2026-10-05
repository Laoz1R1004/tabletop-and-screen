import {hashPin, formatDecimal} from './domain.js';
import {showDialogWithoutScroll} from './dialog-position.js';
import {loadState, loadDraft, saveDraft, clearDraft, saveSession, deleteSession, syncSession, setSessionPin, snapshotCover, createBackupPayload, downloadBackup} from './storage.js';
import {createSession, createPhase, addSessionGame, sessionItems, sessionTitle, sessionSummary, sortSessions, validateSession, moveItem, SESSION_STATUSES, ITEM_STATUSES, SESSION_THEMES} from './session-domain.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${{up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',remove:'M6 6l12 12M18 6 6 18',grip:'M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1'}[name]}"/></svg>`;
const options = (values,value) => values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('');
const textField = (label,value,attributes='') => `<label class="session-field"><span>${label}</span><input value="${esc(value)}" ${attributes}></label>`;
const coverHTML = (cover,name,cls='') => /^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(cover||'') ? `<img class="session-cover ${cls}" src="${esc(cover)}" alt="${esc(name)}的封面" loading="lazy">` : '<div class="session-cover session-cover-placeholder" aria-label="无封面">一桌</div>';
let state, current=null, editing=false, unlocked=false, dirty=false, busy=false, pickerPhase='', draftTimer, draftQueue=Promise.resolve(), pickerGeneration=0;
const DRAFT_KEY='tabletop-session-draft';
const coverCache=new Map();
function notify(message) {
  const box=document.createElement('div');box.className='toast';box.textContent=message;$('#sessionToast').append(box);setTimeout(()=>box.remove(),6000);
}
function confirmAction(title,text) {
  $('#sessionConfirmTitle').textContent=title;$('#sessionConfirmText').textContent=text;
  const dialog=$('#sessionConfirm');dialog.returnValue='';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true}));
}
function askUnlock() {
  if(unlocked)return Promise.resolve(true);
  const dialog=$('#sessionPinDialog');$('#sessionPinForm').reset();$('#sessionPinError').textContent='';
  $('#sessionPinTitle').textContent=state.security.pinHash?'进入编辑':'设置编辑密码';
  $('#sessionPinConfirm').hidden=!!state.security.pinHash;
  showDialogWithoutScroll(dialog,dialog.querySelector('input'));
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(unlocked),{once:true}));
}
$('#sessionPinForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget, button=form.querySelector('[type=submit]');button.disabled=true;
  try {
    const pin=new FormData(form).get('pin'), hash=await hashPin(pin);
    state=await loadState();
    if(state.security.pinHash) {if(hash!==state.security.pinHash)throw Error('密码不正确，请重新输入');}
    else {if(pin!==new FormData(form).get('confirm'))throw Error('两次密码不一致');await setSessionPin(hash);state.security.pinHash=hash;}
    unlocked=true;dialogClose('sessionPinDialog');$('#sessionMode').textContent='退出编辑';
  } catch(error) {$('#sessionPinError').textContent=error.message;} finally {button.disabled=false;}
});
function dialogClose(id) { document.getElementById(id)?.close(); }
function persistDraft() {
  clearTimeout(draftTimer);
  if(!dirty || !current)return draftQueue;
  const draft=structuredClone(current);
  draftQueue=draftQueue.catch(()=>{}).then(()=>saveDraft(DRAFT_KEY,draft)).then(()=>{
    const label=$('#draftStatus');if(label && dirty)label.textContent='草稿已保存在本机 · 尚未正式保存';
    $('#resumeDraft').hidden=false;
  }).catch(error=>{notify('草稿保存失败：'+error.message);throw error;});
  return draftQueue;
}
function markDirty() {
  dirty=true;clearTimeout(draftTimer);draftTimer=setTimeout(()=>persistDraft().catch(()=>{}),350);
  if($('#draftStatus'))$('#draftStatus').textContent='正在保存草稿…';
  updateSummary();
}
async function removeDraft() { clearTimeout(draftTimer);await draftQueue.catch(()=>{});await clearDraft(DRAFT_KEY);$('#resumeDraft').hidden=true; }
async function leaveCurrent() {
  if(!dirty)return true;
  if(!await confirmAction('离开当前编辑？','未正式保存的修改会保留在本机草稿中。新建或编辑另一场时将替换这份草稿。'))return false;
  await persistDraft();return true;
}
function renderList() {
  $('#sessionCount').textContent=`${state.sessions.length} 场`;
  $('#sessionList').innerHTML=sortSessions(state.sessions).map(s=>`<button class="session-history-entry" data-action="open" data-id="${esc(s.id)}" aria-current="${s.id===current?.id}"><time datetime="${esc(s.date)}">${esc(s.date.replaceAll('-',' / '))}</time><strong>${esc(s.title || s.theme+'桌游局')}</strong><small>${esc(s.status)} · ${s.players} 人 · ${sessionItems(s).length} 款</small></button>`).join('') || '<p class="session-muted" style="padding:12px 8px">第一场好时光，等你来安排。</p>';
}
function summaryHTML() {
  const stats=sessionSummary(current);
  return `<span><strong>${stats.games}</strong>款桌游</span><span><strong>${stats.planned}</strong>局计划</span><span><strong>${stats.actual}</strong>局实玩</span><span>${stats.minutes ? `<strong>${stats.minutes}</strong>分钟预估${stats.untimed?' · 部分待填':''}` : '时长待安排'}</span>`;
}
function updateSummary() { if(current && $('#sessionSummary'))$('#sessionSummary').innerHTML=summaryHTML(); }
function itemHTML(item,phase,index) {
  const s=item.snapshot;
  return `<article class="session-game" data-item="${esc(item.id)}">
    ${coverHTML(s.cover,s.name)}<div class="session-game-content">
    <div class="session-game-heading"><div><h4>${esc(s.name)}</h4><div class="session-game-version">${esc(s.version || '版本未记录')}</div></div>${editing?`<div class="session-item-move"><button class="session-icon drag-handle" type="button" draggable="true" data-drag-item="${esc(item.id)}" aria-label="拖动${esc(s.name)}排序">${icon('grip')}</button><button class="session-icon" data-action="item-up" data-id="${esc(item.id)}" ${index===0?'disabled':''} aria-label="上移${esc(s.name)}">${icon('up')}</button><button class="session-icon" data-action="item-down" data-id="${esc(item.id)}" ${index===phase.items.length-1?'disabled':''} aria-label="下移${esc(s.name)}">${icon('down')}</button><button class="session-icon" data-action="remove-item" data-id="${esc(item.id)}" ${item.synced?'disabled':''} aria-label="移除${esc(s.name)}" title="${item.synced?'已同步记录不可移除':'移除桌游'}">${icon('remove')}</button></div>`:`<span class="session-tag">${esc(item.status)}</span>`}</div>
    <div class="session-game-tags">${s.designSchool?`<span class="session-tag">${esc(s.designSchool)}</span>`:''}<span class="session-muted">重度 ${formatDecimal(s.weight)} · 评分 ${formatDecimal(s.rating)}</span>${s.playerMin?`<span class="session-muted">${esc(s.playerMin)}–${esc(s.playerMax)} 人</span>`:''}</div>
    ${editing?`<div class="session-item-form">
      ${textField('计划局数',item.planned,`type="number" min="1" max="100000" step="1" required data-i="planned" data-id="${esc(item.id)}"`)}
      ${textField('实玩局数',item.actual,`type="number" min="${item.synced}" max="100000" step="1" required data-i="actual" data-id="${esc(item.id)}"`)}
      ${textField('每局分钟 · 可空',item.minutes,`type="number" min="1" max="100000" step="1" data-i="minutes" data-id="${esc(item.id)}"`)}
      <label class="session-field"><span>本场状态</span><select data-i="status" data-id="${esc(item.id)}">${options(ITEM_STATUSES,item.status)}</select></label>
    </div><details class="session-notes"><summary>游戏感想与阶段调整${item.notes?' · 已有感想':''}</summary><label class="session-field"><span>这一款玩得如何？</span><textarea data-i="notes" data-id="${esc(item.id)}" rows="2">${esc(item.notes)}</textarea></label><label class="session-field" style="margin-top:12px"><span>移动到阶段</span><select data-move="${esc(item.id)}">${current.phases.map(p=>`<option value="${esc(p.id)}" ${p.id===phase.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></details>`:`<div class="session-game-metrics"><span>计划 <strong>${item.planned}</strong> 局</span><span>实玩 <strong>${item.actual}</strong> 局</span>${item.minutes?`<span>每局约 <strong>${item.minutes}</strong> 分钟</span>`:''}</div>${item.notes?`<p class="session-note-text">${esc(item.notes)}</p>`:''}`}
    ${item.synced?`<p class="session-muted" style="margin-top:10px">已计入收藏 ${item.synced} 局</p>`:''}</div></article>`;
}
function phaseHTML(phase,index) {
  return `<section class="session-phase" data-phase="${esc(phase.id)}"><div class="phase-heading"><span class="phase-number">${String(index+1).padStart(2,'0')}</span>
    ${editing?`<input class="phase-name" aria-label="第${index+1}阶段名称" value="${esc(phase.name)}" maxlength="40" required data-p="name" data-id="${esc(phase.id)}"><div class="phase-tools"><button class="session-icon drag-handle" draggable="true" data-drag-phase="${esc(phase.id)}" aria-label="拖动阶段排序">${icon('grip')}</button><button class="session-icon" data-action="phase-up" data-id="${esc(phase.id)}" ${index===0?'disabled':''} aria-label="上移阶段">${icon('up')}</button><button class="session-icon" data-action="phase-down" data-id="${esc(phase.id)}" ${index===current.phases.length-1?'disabled':''} aria-label="下移阶段">${icon('down')}</button><button class="session-icon" data-action="remove-phase" data-id="${esc(phase.id)}" ${current.phases.length===1?'disabled':''} aria-label="删除阶段">${icon('remove')}</button><button class="ghost-button" data-action="pick" data-id="${esc(phase.id)}">＋ 选桌游</button></div>`:`<h3>${esc(phase.name)}</h3><span class="session-muted">${phase.items.length} 款</span>`}</div>
    <div class="phase-items">${phase.items.map((item,i)=>itemHTML(item,phase,i)).join('') || `<div class="phase-empty"><span>留一点空位，给这场聚会。</span>${editing?`<button class="ghost-button" data-action="pick" data-id="${esc(phase.id)}">从收藏中挑选 →</button>`:''}</div>`}</div></section>`;
}
function render() {
  renderList();
  $('#sessionMode').textContent=unlocked?'退出编辑':'进入编辑';
  if(!current) { $('#sessionDetail').innerHTML='<div class="session-empty liquid-strong"><p class="session-eyebrow">A SEAT AT THE TABLE</p><h2>下一场，从这里开始。</h2><p class="session-muted">先定下日期、主题和人数，再把想玩的桌游依次放进各个阶段。结束后，回来写几句感想。</p><button class="primary-button" data-action="new">安排第一场桌游局</button></div>';return; }
  $('#sessionDetail').innerHTML=`<div class="session-sheet liquid-strong"><div class="session-topline"><p class="session-eyebrow">${editing?'PLAN YOUR SESSION':'SESSION JOURNAL'}</p><div class="session-tools">${!editing?'<button class="secondary-button" data-action="edit">编辑这场</button>':''}<span class="session-tag">${esc(current.status)}</span></div></div>
    ${editing?`<div class="session-meta-form"><label class="session-field session-title-field"><span>桌游局名称 · 留空自动命名</span><input data-s="title" value="${esc(current.title)}" maxlength="120" placeholder="${esc(current.date+' · '+current.theme)}"></label>
      ${textField('日期',current.date,'type="date" required data-s="date"')}
      ${textField('今日主题',current.theme,'list="sessionThemes" maxlength="40" required data-s="theme"')}<datalist id="sessionThemes">${SESSION_THEMES.map(t=>`<option value="${t}">`).join('')}</datalist>
      ${textField('人数',current.players,'type="number" min="1" max="100000" step="1" required data-s="players"')}
      <label class="session-field"><span>桌游局状态</span><select data-s="status">${options(SESSION_STATUSES,current.status)}</select></label></div>`:`<h2>${esc(sessionTitle(current))}</h2><div class="session-meta"><time datetime="${esc(current.date)}">${esc(current.date.replaceAll('-',' / '))}</time><span>${esc(current.theme)}</span><span>${current.players} 人</span></div>`}
    <div class="session-summary" id="sessionSummary">${summaryHTML()}</div></div>
    <div class="session-phases">${current.phases.map(phaseHTML).join('')}</div>
    ${editing?'<button class="secondary-button" data-action="add-phase">＋ 添加自定义阶段</button>':''}
    <section class="session-reflection liquid-strong"><h3>散场之后</h3>${editing?`<label class="session-field"><span>记录今天的感想、精彩瞬间，或下一次的安排</span><textarea data-s="notes" rows="4" placeholder="今天最值得记住的是……">${esc(current.notes)}</textarea></label>`:`<p class="session-note-text">${esc(current.notes || '感想还留着空白，等散场之后慢慢写。')}</p>`}</section>
    ${editing?'<div class="session-savebar liquid-strong"><span id="draftStatus">编辑本场 · 保存后生效</span><button class="ghost-button" data-action="cancel">取消编辑</button><button class="primary-button" data-action="save">保存桌游局</button></div>':`<div class="session-savebar liquid-strong"><span id="draftStatus">本机保存 · 备份包含桌游局</span><button class="ghost-button" data-action="delete">删除记录</button><button class="secondary-button" data-action="sync">将实玩局数计入收藏</button></div>`}
    <p class="session-footer-note">游戏资料按加入时留存快照。收藏中的名称或封面变更，不会改变这份记录。实玩局数只在你主动同步时计入收藏，重复同步不会重复累加。</p>`;
}
async function openSession(id) {
  if(!await leaveCurrent())return;state=await loadState();current=structuredClone(state.sessions.find(s=>s.id===id) || null);dirty=false;editing=false;render();
}
async function beginEdit() {
  if(!current || !await askUnlock())return;
  const saved=state.sessions.find(s=>s.id===current.id);
  if(saved)current=structuredClone(saved);
  editing=true;render();
}
async function save() {
  const invalid=[...$('#sessionDetail').querySelectorAll('input,select,textarea')].find(el=>!el.checkValidity());
  if(invalid){invalid.reportValidity();return;}
  const errors=validateSession(current);if(errors.length)throw Error(errors.join('；'));
  current=await saveSession(current);dirty=false;await removeDraft();editing=false;state=await loadState();render();notify('桌游局已保存');
}
async function loadCover(game) {
  if(!coverCache.has(game.coverId))coverCache.set(game.coverId,snapshotCover(game.coverId).catch(()=>''));
  return coverCache.get(game.coverId);
}
async function renderPicker() {
  const generation=++pickerGeneration;
  const query=$('#pickerSearch').value.trim().toLocaleLowerCase(),school=$('#pickerSchool').value,weight=$('#pickerWeight').value;
  const selected=new Set(sessionItems(current).map(i=>i.gameId));
  const games=state.games.filter(g=>g.itemType!=='collection').filter(g=>
    (!query || [g.name,g.version,...(g.themes||[])].some(v=>String(v||'').toLocaleLowerCase().includes(query))) &&
    (!school || g.designSchool===school) &&
    (!$('#pickerOwned').checked || g.price!==null && g.price!=='' && g.price!==undefined) &&
    (!$('#pickerFits').checked || g.playerMin && g.playerMax && g.playerMin<=current.players && g.playerMax>=current.players) &&
    (weight==='' || g.weight!==null && g.weight!==undefined && g.weight!=='' && Number(g.weight)>=Number(weight) && (Number(weight)===4 ? Number(g.weight)<=5 : Number(g.weight)<(Number(weight)===0?2:Number(weight)+1)))
  ).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('#pickerHint').textContent=`${games.length} 款可选 · 本场已选 ${selected.size} 款 · 同一桌游只添加一次，多局请调整计划局数`;
  $('#pickerResults').innerHTML=games.map(g=>`<article class="picker-card"><div data-picker-cover="${esc(g.id)}">${coverHTML('',g.name)}</div><div><h3>${esc(g.name)}</h3><small>${esc(g.version)} · ${esc(g.designSchool)}</small><small>重度 ${formatDecimal(g.weight)} · 评分 ${formatDecimal(g.rating)}</small><small>${g.playerMin?`${esc(g.playerMin)}–${esc(g.playerMax)} 人`:'人数未记录'}${g.playerMin && (current.players<g.playerMin || current.players>g.playerMax)?' · 本场人数不符':''}</small></div><button class="secondary-button" data-action="add-game" data-id="${esc(g.id)}" ${selected.has(g.id)?'disabled':''}>${selected.has(g.id)?'已选':'加入'}</button></article>`).join('') || '<p class="session-muted">没有符合条件的桌游。可调整筛选，或先到一桌录入收藏。</p>';
  for(const game of games) {
    const cover=await loadCover(game);if(generation!==pickerGeneration)return;
    const element=[...document.querySelectorAll('[data-picker-cover]')].find(e=>e.dataset.pickerCover===game.id);
    if(element)element.innerHTML=coverHTML(cover,game.name);
  }
}
async function handleAction(action,id) {
  if(action==='backup'){downloadBackup(await createBackupPayload());notify('完整备份已导出，包含收藏和桌游局');return;}
  if(action==='mode'){
    if(unlocked){if(!await leaveCurrent())return;unlocked=false;editing=false;dirty=false;current=current?.revision?structuredClone(state.sessions.find(s=>s.id===current.id) || null):null;render();}
    else if(await askUnlock()) {if(current)await beginEdit();else render();}return;
  }
  if(action==='new'){
    if(!await leaveCurrent() || !await askUnlock())return;
    if(await loadDraft(DRAFT_KEY) && !await confirmAction('新建一场桌游局？','现有未保存草稿将被这场新安排替换。正式保存过的记录不会变化。'))return;
    current=createSession();editing=true;render();markDirty();return;
  }
  if(action==='open'){await openSession(id);return;}
  if(action==='resume'){
    if(!await leaveCurrent() || !await askUnlock())return;
    const draft=await loadDraft(DRAFT_KEY);if(!draft){notify('暂无草稿');return;}
    const old=state.sessions.find(s=>s.id===draft.id);
    if((old?.revision||0)!==draft.revision){notify('原记录已更新，旧草稿无法覆盖。请从记录列表打开最新版本。');return;}
    current=draft;editing=true;dirty=true;render();return;
  }
  if(action==='edit'){await beginEdit();return;}
  if(!current)return;
  if(action==='delete'){
    if(!await askUnlock() || !await confirmAction('删除这场桌游局？','记录和感想将被删除；已同步进收藏的开局数不会回退。建议先导出备份。'))return;
    await deleteSession(current.id,current.revision);state=await loadState();current=null;editing=false;render();notify('桌游局已删除');return;
  }
  if(action==='sync'){
    if(!await askUnlock())return;
    const delta=sessionItems(current).reduce((n,i)=>n+Math.max(0,i.actual-i.synced),0);
    if(!delta){notify('没有尚未同步的实玩局数；如有新进度，请先编辑实玩局数。');return;}
    if(!await confirmAction('计入收藏开局数？',`本次将补记 ${delta} 局。只更新开局数，不改变评分或收藏备注。`))return;
    const result=await syncSession(current.id,current.revision);current=result.session;state=await loadState();render();notify(`已计入 ${result.added} 局，重复同步不会重复累计`);return;
  }
  if(!editing || !unlocked)return;
  if(action==='save'){await save();return;}
  if(action==='cancel'){
    if(dirty && !await confirmAction('放弃这次修改？','当前未保存的修改和草稿会被移除，正式保存的记录不会变化。'))return;
    dirty=false;await removeDraft();current=structuredClone(state.sessions.find(s=>s.id===current.id)||null);editing=false;render();return;
  }
  if(action==='pick'){
    pickerPhase=id;state=await loadState();$('#pickerTitle').textContent=`为「${current.phases.find(p=>p.id===id).name}」选桌游`;
    $('#pickerSearch').value='';$('#pickerSchool').innerHTML='<option value="">全部流派</option>'+options(state.taxonomies.designSchool,'');
    $('#gamePicker').showModal();await renderPicker();return;
  }
  if(action==='add-game'){
    const game=state.games.find(g=>g.id===id);if(!game)throw Error('收藏中已找不到这款桌游');
    addSessionGame(current,pickerPhase,game,await loadCover(game));markDirty();render();await renderPicker();return;
  }
  if(action==='add-phase')current.phases.push(createPhase());
  else if(action==='remove-phase'){
    const phase=current.phases.find(p=>p.id===id);
    if(current.phases.length===1)return;
    if(phase.items.some(i=>i.synced))throw Error('此阶段包含已同步桌游，请先把它们移到其他阶段');
    if(phase.items.length && !await confirmAction('删除这个阶段？',`「${phase.name}」及其中 ${phase.items.length} 款安排将被移除。`))return;
    current.phases=current.phases.filter(p=>p.id!==id);
  } else if(action==='remove-item'){
    const phase=current.phases.find(p=>p.items.some(i=>i.id===id)),item=phase.items.find(i=>i.id===id);
    if(item.synced)throw Error('已同步桌游不能移除');
    if(!await confirmAction('移除这款桌游？',`只移除本场的「${item.snapshot.name}」安排，不删除收藏。`))return;
    phase.items=phase.items.filter(i=>i.id!==id);
  } else if(action.startsWith('phase-')){
    const index=current.phases.findIndex(p=>p.id===id),target=index+(action==='phase-up'?-1:1);
    if(target<0 || target>=current.phases.length)return;
    [current.phases[index],current.phases[target]]=[current.phases[target],current.phases[index]];
  } else if(action.startsWith('item-')){
    const phase=current.phases.find(p=>p.items.some(i=>i.id===id)),index=phase.items.findIndex(i=>i.id===id);
    moveItem(current,id,phase.id,index+(action==='item-up'?-1:1));
  } else return;
  markDirty();render();
}
document.addEventListener('click',async event=>{
  const close=event.target.closest('[data-close]');if(close){dialogClose(close.dataset.close);return;}
  const button=event.target.closest('[data-action]');if(!button || button.disabled || busy)return;
  busy=true;button.setAttribute('aria-busy','true');
  try {await handleAction(button.dataset.action,button.dataset.id);}catch(error){notify(error.message);}finally{busy=false;button.removeAttribute('aria-busy');}
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='pickerSearch'){renderPicker().catch(e=>notify(e.message));return;}
  if(!editing || !unlocked || !current)return;
  if(el.dataset.s)current[el.dataset.s]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;
  else if(el.dataset.p)current.phases.find(p=>p.id===el.dataset.id)[el.dataset.p]=el.value;
  else if(el.dataset.i)sessionItems(current).find(i=>i.id===el.dataset.id)[el.dataset.i]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;
  else return;
  markDirty();
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.closest('.picker-filters')){renderPicker().catch(e=>notify(e.message));return;}
  if(el.dataset.move && editing){moveItem(current,el.dataset.move,el.value,current.phases.find(p=>p.id===el.value).items.length);markDirty();render();}
});
let dragging=null;
document.addEventListener('dragstart',event=>{
  const handle=event.target.closest('[data-drag-item],[data-drag-phase]');if(!handle || !editing){event.preventDefault();return;}
  dragging=handle.dataset.dragItem?{item:handle.dataset.dragItem}:{phase:handle.dataset.dragPhase};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(dragging));
});
document.addEventListener('dragover',event=>{
  if(!dragging)return;const target=event.target.closest(dragging.item?'[data-item],[data-phase]':'[data-phase]');if(!target)return;
  event.preventDefault();event.dataTransfer.dropEffect='move';document.querySelectorAll('.drag-over').forEach(e=>e.classList.remove('drag-over'));target.classList.add('drag-over');
});
document.addEventListener('drop',event=>{
  if(!dragging || !editing)return;const phaseEl=event.target.closest('[data-phase]');if(!phaseEl)return;event.preventDefault();
  const target=current.phases.find(p=>p.id===phaseEl.dataset.phase);
  if(dragging.item){const before=event.target.closest('[data-item]')?.dataset.item;if(before===dragging.item)return;const items=target.items.filter(i=>i.id!==dragging.item);moveItem(current,dragging.item,target.id,before?items.findIndex(i=>i.id===before):items.length);}
  else {const source=current.phases.findIndex(p=>p.id===dragging.phase),index=current.phases.indexOf(target);const [phase]=current.phases.splice(source,1);current.phases.splice(index,0,phase);}
  dragging=null;markDirty();render();
});
document.addEventListener('dragend',()=>{dragging=null;document.querySelectorAll('.drag-over').forEach(e=>e.classList.remove('drag-over'));});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden && dirty)persistDraft().catch(()=>{});});
try {state=await loadState();current=structuredClone(sortSessions(state.sessions)[0]||null);$('#resumeDraft').hidden=!await loadDraft(DRAFT_KEY);render();}
catch(error){$('#sessionDetail').textContent='无法读取本机记录，请不要清除浏览器数据。'+error.message;}
