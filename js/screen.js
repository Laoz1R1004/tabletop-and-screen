import {applyFilters, formatDecimal, hashPin} from './domain.js';
import {RATINGS, PLATFORMS, PROGRESS, blank, themeTags, emptyScreenGame, normalizeHours, formatHours, validateScreenGame, sortScreenGames, groupScreenGames, screenGroupKeys, searchScreenGames} from './screen-domain.js';
import {loadState, saveState, loadDraft, saveDraft, clearDraft, putImage, getImage, createBackupPayload, downloadBackup, readBackupFile, restoreBackup, summarizeBackup} from './storage.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = (v='') => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const GROUP = {types:'类型',themes:'主题',platform:'主平台',rating:'评级',progress:'进度',developer:'开发商',owned:'购入状态'};
const SORT = {rating:'评级 → 名称',name:'名称',price:'购入价',hours:'游戏时长',createdAt:'创建时间',updatedAt:'修改时间'};
const FILTER = {...GROUP,name:'名称',price:'购入价',hours:'游戏时长'};
let app, editing=false, openId=null, openGroup=null, draft=null, isNew=false, dirty=false, timer, taxTab='types', tempFilters=[], urls=[], imageBusy=false, renderVersion=0;
const data = () => app.screen;
const persist = () => saveState(app,'screen');
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${({plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="m6 6 12 12M18 6 6 18"/>',image:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 18 5-6 4 4 3-3 4 5"/>',chev:'<path d="m7 9 5 5 5-5"/>',edit:'<path d="m4 20 4-1L20 7l-3-3L5 16Z"/>',trash:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/>'})[name] || ''}</svg>`;
function toast(message) { const n=document.createElement('div');n.className='toast';n.textContent=message;$('#toastRegion').append(n);setTimeout(()=>n.remove(),5000); }
const safe = fn => async e => {try {await fn(e)} catch(error) {console.error(error);toast(error.message || '操作失败，请重试');}};
function guarded() {if(draft){toast('请先保存或取消当前编辑');return true}return false}
function badge(g, large=false) {return `<span class="grade-badge ${large?'grade-badge--large':''} grade-${g.rating ? RATINGS.indexOf(g.rating) : 'empty'}" aria-label="${g.rating?`个人评级 ${esc(g.rating)} 级`:'未评级'}" title="${g.rating?`${esc(g.rating)} 级`:'未评级'}">${esc(g.rating || '—')}</span>`}
function cover(g, original=false) {return `<div class="cover-frame"><div class="cover-frame__blur" data-cover="${esc(g.coverId)}" data-bg></div>${g.coverId?`<img class="cover-frame__image" data-cover="${esc(g.coverId)}" data-size="${original?'original':'thumbnail'}" alt="${esc(g.name)}封面">`:`<div class="cover-placeholder">${svg('image')}</div>`}</div>`}
function tags(items, extra='') {return items.map(t=>`<span class="game-tag ${extra}" title="${esc(t)}">${esc(t)}</span>`).join('')}
function card(g,key) {
  const length=[...g.name].length;
  return `<article class="game-card screen-card"><button type="button" class="game-card__button" data-act="open" data-id="${esc(g.id)}" data-group="${esc(key)}" aria-expanded="${openId===g.id&&openGroup===key}">${cover(g)}<div class="game-card__body"><h3 class="game-card__title ${length>24?'is-very-long':length>14?'is-long':''}" title="${esc(g.name)}">${esc(g.name)}</h3><div class="screen-card__summary">${badge(g)}<span class="progress-label"><span class="progress-dot progress-${PROGRESS.indexOf(g.progress)}" aria-hidden="true"></span>${esc(g.progress)}</span></div><div class="screen-card__types">${tags(g.types,'game-tag--school')}</div><div class="screen-card__themes">${tags(g.themes.slice(0,2))}${g.themes.length>2?`<span class="game-tag theme-overflow" aria-label="另有 ${g.themes.length-2} 个主题">+${g.themes.length-2}</span>`:''}</div></div></button></article>`;
}
const fact = (label,value) => `<div class="fact"><span>${label}</span><strong>${esc(value)}</strong></div>`;
function stage(g) {return `<article class="game-stage screen-stage" data-stage-id="${esc(g.id)}"><div class="stage-grid"><div class="stage-cover">${cover(g,true)}</div><div class="stage-content"><div class="stage-head"><div class="stage-title"><h2>${esc(g.name)}</h2><p>${esc(g.developer || '开发商未记录')}</p></div><div class="stage-actions">${editing?`<button class="primary-button" data-act="edit">${svg('edit')}编辑游戏</button>`:''}<button class="square-button" data-act="close" aria-label="收起游戏">${svg('x')}</button></div></div><div class="screen-stage__rating">${badge(g,true)}<div><span class="screen-stage__label">个人评级</span><p>${g.rating?`${esc(g.rating)} 级`:'尚未评级'}</p></div></div><div class="fact-grid">${fact('游戏进度',g.progress)}${fact('主平台',g.platform)}${fact('游戏时长',formatHours(g.hours))}${fact('购入价',blank(g.price)?'未购入':`¥ ${formatDecimal(g.price)}`)}</div><section class="stage-section"><h3>游戏类型</h3><div class="game-tags">${tags(g.types,'game-tag--school')}</div></section><section class="stage-section"><h3>主题</h3><div class="game-tags">${tags(g.themes)||'<span class="stage-notes">未记录</span>'}</div></section><section class="stage-section"><h3>个人评价</h3><p class="stage-notes">${esc(g.notes||'还没有写下评价。')}</p></section></div></div></article>`}
const choices = (field,list,selected,multi=false) => `<div class="option-grid">${list.map(v=>`<button type="button" class="option-chip" data-act="choice" data-field="${field}" data-value="${esc(v)}" aria-pressed="${multi?selected.includes(v):selected===v}">${esc(v)}</button>`).join('')}</div>`;
const input = (label,name,value,attributes='') => `<label class="editor-field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attributes}></label>`;
function editor() {
  const g=draft;
  return `<article class="game-stage screen-stage" data-stage-id="${esc(g.id)}"><form id="gameEditor" class="editor-form" novalidate><div class="stage-grid"><div class="stage-cover"><label class="image-drop" tabindex="0" aria-label="上传游戏封面，可拖入或粘贴图片">${g.coverId?`<img data-cover="${esc(g.coverId)}" alt="封面预览">`:`<span>${svg('image')}<br>上传游戏封面 · 必填<br><small>选择、拖放或粘贴图片</small></span>`}<input type="file" accept="image/*" id="coverInput"></label></div><div class="stage-content"><div class="stage-head"><div class="stage-title"><h2>${isNew?'添加游戏':'编辑游戏'}</h2><p>草稿保存在当前浏览器，保存后进入收藏</p></div><button type="button" class="square-button" data-act="cancel" aria-label="取消编辑">${svg('x')}</button></div><div id="editorErrors" role="alert"></div><div class="editor-grid">${input('游戏名称 · 必填','name',g.name,'required')}${input('开发商','developer',g.developer)}${input('购入价 · 元','price',blank(g.price)?'':formatDecimal(g.price),'type="number" min="0" step="0.01" placeholder="留空表示未购入"')}${input('游戏时长 · 小时','hours',blank(g.hours)?'':g.hours,'type="number" min="0" step="any" placeholder="留空表示未记录"')}<label class="editor-field"><span>游戏进度</span><select name="progress">${PROGRESS.map(v=>`<option ${v===g.progress?'selected':''}>${v}</option>`).join('')}</select></label><label class="editor-field"><span>主平台 · 必填</span><select name="platform" required><option value="">请选择主平台</option>${PLATFORMS.map(v=>`<option ${v===g.platform?'selected':''}>${v}</option>`).join('')}</select></label><div class="editor-field editor-field--full"><span>个人评级 · 可留空</span>${choices('rating',RATINGS,g.rating)}<small>再次点击已选评级可清空。</small></div><div class="editor-field editor-field--full"><span>类型 · 必填，最多 2 个</span>${choices('types',data().taxonomies.types,g.types,true)}</div><label class="editor-field editor-field--full"><span>主题 · 用逗号分隔，前两个显示在卡片上</span><input name="themes" value="${esc(g.themes.join('，'))}" placeholder="例如：科幻，探索"></label><div class="editor-field editor-field--full theme-suggestions">${choices('themes',data().taxonomies.themes,g.themes,true)}</div><label class="editor-field editor-field--full"><span>个人评价</span><textarea name="notes">${esc(g.notes)}</textarea></label></div><div class="stage-savebar"><span id="saveStatus" class="save-status">${imageBusy?'正在处理封面…':dirty?'草稿待保存':'尚未修改'}</span><div class="save-actions">${isNew?'':'<button type="button" class="danger-button" data-act="delete">删除游戏</button>'}<button type="button" class="ghost-button" data-act="cancel">取消</button><button type="submit" class="primary-button" ${imageBusy?'disabled':''}>保存修改</button></div></div></div></div></form></article>`;
}
function filtered() {return searchScreenGames(applyFilters(data().games,data().view.filters),data().view.search)}
function options() {
  $('#groupSelect').innerHTML=Object.entries(GROUP).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  $('#sortSelect').innerHTML=Object.entries(SORT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  $('#groupSelect').value=data().view.groupBy;$('#sortSelect').value=data().view.sortBy;$('#searchInput').value=data().view.search;
  $('#sortDirectionButton').style.transform=data().view.sortDirection==='asc'?'':'rotate(180deg)';
  $('#sortDirectionButton').ariaLabel=data().view.sortDirection==='asc'?'当前正序，点击反序（评级正序为 S 到 B）':'当前反序，点击正序';
}
async function hydrate(version) {
  await Promise.all($$('[data-cover]').map(async n=>{
    const blob=await getImage(n.dataset.cover,n.dataset.size||'thumbnail');
    if(!blob||version!==renderVersion||!n.isConnected)return;
    const url=URL.createObjectURL(blob);urls.push(url);
    if(n.hasAttribute('data-bg'))n.style.backgroundImage=`url("${url}")`;else n.src=url;
  }));
  const g=data().games.find(g=>g.id===openId),ambient=$('#ambientCover');
  ambient.classList.remove('is-visible');
  if(g?.coverId){const blob=await getImage(g.coverId);if(blob&&version===renderVersion){const url=URL.createObjectURL(blob);urls.push(url);ambient.style.backgroundImage=`url("${url}")`;ambient.classList.add('is-visible')}}
}
function render() {
  urls.forEach(URL.revokeObjectURL);urls=[];const version=++renderVersion;
  $('#collectionCount').textContent=data().games.length;
  $('#addGameButton').hidden=$('#categoryButton').hidden=!editing;
  $('#editModeButton').classList.toggle('is-active',editing);$('#viewModeButton').classList.toggle('is-active',!editing);
  $('#filterCount').hidden=!data().view.filters.length;$('#filterCount').textContent=data().view.filters.length;
  $('#activeFilters').innerHTML=data().view.filters.map((f,i)=>`<span class="filter-chip">${FILTER[f.field]} · ${esc(['empty','filled'].includes(f.operator)?f.operator==='empty'?'未填写':'已填写':Array.isArray(f.value)?f.value.join('、'):f.value)}<button data-act="remove-filter" data-index="${i}" aria-label="移除${FILTER[f.field]}筛选">${svg('x')}</button></span>`).join('');
  const groups=groupScreenGames(filtered(),data().view.groupBy,data().taxonomies);
  let html=isNew&&draft?`<section class="group"><div class="game-grid">${editor()}</div></section>`:'';
  html+=groups.map(({key,games})=>`<section class="group ${data().view.collapsedGroups.includes(key)?'is-collapsed':''}"><div class="group-head"><div class="group-title"><h2>${esc(key==='__empty'?(data().view.groupBy==='rating'?'未评级':'未分类'):key)}</h2><span>${games.length} 款</span></div><button class="group-toggle" data-act="group" data-group="${esc(key)}" aria-label="切换${esc(key)}分组" aria-expanded="${!data().view.collapsedGroups.includes(key)}">${svg('chev')}</button></div><div class="game-grid">${sortScreenGames(games,data().view.sortBy,data().view.sortDirection).map(g=>card(g,key)+(g.id===openId&&key===openGroup?(draft?editor():stage(g)):'')).join('')}</div></section>`).join('');
  if(!html)html=`<div class="empty-collection"><div><div class="empty-object" aria-hidden="true"><span></span><span></span><span></span></div><h2>${data().games.length?'没有符合条件的游戏':'下一段冒险，从这里收藏'}</h2><p>${data().games.length?'试试其他类型、主题或关键词。':'留下值得记住的游戏，和你自己的评价。'}</p><button class="primary-button" data-act="${data().games.length?'reset':'new'}">${data().games.length?'清除搜索与筛选':'添加第一款游戏'}</button></div></div>`;
  $('#collection').innerHTML=html;
  hydrate(version).catch(e=>toast(e.message));
}
function readForm() {
  if(!draft||!$('#gameEditor'))return;
  const f=new FormData($('#gameEditor'));
  ['name','developer','platform','progress','notes'].forEach(k=>draft[k]=String(f.get(k)||''));
  ['price','hours'].forEach(k=>draft[k]=f.get(k)===''?null:Number(f.get(k)));
  draft.themes=themeTags(String(f.get('themes')||''));
}
function draftKey(){return isNew?'screen-new':draft.id}
function queueDraft() {
  dirty=true;clearTimeout(timer);const key=draftKey(),snapshot=structuredClone(draft);
  timer=setTimeout(()=>saveDraft(key,snapshot).then(()=>{if($('#saveStatus'))$('#saveStatus').textContent='草稿已保存'}).catch(e=>toast(`草稿保存失败：${e.message}`)),250);
}
async function ask(title,body,label='确认') {
  const dialog=$('#confirmDialog');$('#confirmTitle').textContent=title;$('#confirmBody').innerHTML=body;$('#confirmAction').textContent=label;
  dialog.returnValue='';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}
async function unlock() {
  app=await loadState();const setup=!app.security.pinHash;
  $('#pinTitle').textContent=setup?'创建编辑密码':'进入编辑模式';$('#pinDescription').textContent=setup?'设置共用于一桌与一屏的六位数字密码。':'输入一桌·一屏的六位数字密码。';
  $('#pinConfirmField').hidden=!setup;$('#pinInput').value=$('#pinConfirmInput').value='';$('#pinError').textContent='';
  $('#pinDialog').dataset.setup=String(setup);$('#pinDialog').showModal();
  return new Promise(resolve=>$('#pinDialog').addEventListener('close',()=>resolve(editing),{once:true}));
}
async function startNew() {if(guarded())return;if(!editing&&!await unlock())return;draft=await loadDraft('screen-new')||emptyScreenGame();isNew=true;dirty=false;openId=null;render();scrollStage()}
function scrollStage(){requestAnimationFrame(()=>$('[data-stage-id]')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}))}
async function cancel() {
  if(imageBusy)return toast('封面处理中，请稍候');
  if(dirty&&!await ask('放弃这次修改？','<p>正式收藏保持不变，本次草稿会被清除。</p>','放弃修改'))return;
  clearTimeout(timer);await clearDraft(draftKey());draft=null;dirty=false;isNew=false;render();
}
async function saveGame() {
  if(imageBusy)return;readForm();const errors=validateScreenGame(draft);
  if(Object.keys(errors).length){$('#editorErrors').innerHTML=`<div class="editor-errors">${Object.values(errors).map(esc).join('；')}</div>`;$('#editorErrors').scrollIntoView({block:'nearest'});return}
  const duplicate=data().games.some(g=>g.id!==draft.id&&g.name.trim()===draft.name.trim()&&g.platform===draft.platform);
  if(duplicate&&!await ask('发现同名游戏','<p>相同名称和主平台的游戏已经存在，仍保存为独立条目？</p>','仍然保存'))return;
  clearTimeout(timer);const key=draftKey();draft.name=draft.name.trim();draft.hours=normalizeHours(draft.hours);draft.price=blank(draft.price)?null:Number(draft.price.toFixed(2));draft.updatedAt=new Date().toISOString();
  const i=data().games.findIndex(g=>g.id===draft.id);if(i<0)data().games.push(structuredClone(draft));else data().games[i]=structuredClone(draft);
  data().taxonomies.themes=[...new Set([...data().taxonomies.themes,...draft.themes])];
  await persist();await clearDraft(key);openId=draft.id;openGroup=screenGroupKeys(draft,data().view.groupBy)[0];
  data().view.collapsedGroups=data().view.collapsedGroups.filter(k=>k!==openGroup);draft=null;dirty=false;isNew=false;render();toast('游戏已保存');
}
async function upload(file) {
  if(!draft||imageBusy)return;readForm();imageBusy=true;render();
  try {draft.coverId=await putImage(file);queueDraft()}finally{imageBusy=false;render()}
}
function drawer(id){closeDrawers();$(id).classList.add('is-open');$(id).setAttribute('aria-hidden','false');$('#drawerScrim').hidden=false;$(id).querySelector('button,input,select')?.focus()}
function closeDrawers(){$$('.drawer').forEach(n=>{n.classList.remove('is-open');n.setAttribute('aria-hidden','true')});$('#drawerScrim').hidden=true}
function filterValues(field) {
  return ({types:data().taxonomies.types,themes:data().taxonomies.themes,platform:PLATFORMS,rating:RATINGS,progress:PROGRESS,owned:['已购入','未购入']})[field];
}
const defaultFilter = field => ({field,operator:filterValues(field)?'in':['price','hours'].includes(field)?'gte':'contains',value:filterValues(field)?[]:''});
function filterRows() {
  $('#filterRows').innerHTML=tempFilters.map((f,i)=>{
    const list=filterValues(f.field),ops=list?{in:'包含任意选项',empty:'未填写',filled:'已填写'}:['price','hours'].includes(f.field)?{gte:'大于等于',lte:'小于等于',empty:'未填写',filled:'已填写'}:{contains:'包含文字',empty:'未填写',filled:'已填写'};
    return `<div class="filter-row" data-filter="${i}"><label><span>字段</span><select data-filter-field>${Object.entries(FILTER).map(([k,v])=>`<option value="${k}" ${k===f.field?'selected':''} ${tempFilters.some((x,j)=>j!==i&&x.field===k)?'disabled':''}>${v}</option>`).join('')}</select></label><label><span>条件</span><select data-filter-op>${Object.entries(ops).map(([k,v])=>`<option value="${k}" ${k===f.operator?'selected':''}>${v}</option>`).join('')}</select></label><button class="square-button" data-act="remove-temp" data-index="${i}" aria-label="删除筛选条件">${svg('trash')}</button><div class="filter-value">${['empty','filled'].includes(f.operator)?'<small>无需填写</small>':list?`<div class="option-grid">${list.map(v=>`<button class="option-chip" data-act="filter-choice" data-index="${i}" data-value="${esc(v)}" aria-pressed="${f.value.includes(v)}">${esc(v)}</button>`).join('')||'<small>暂无可选标签</small>'}</div>`:`<label><span>值</span><input data-filter-value type="${['price','hours'].includes(f.field)?'number':'text'}" ${['price','hours'].includes(f.field)?'min="0" step="any"':''} value="${esc(f.value)}"></label>`}</div></div>`;
  }).join('');$('#addFilterButton').disabled=tempFilters.length>=3;
}
function appliedFilters() {
  return tempFilters.map(f=>{
    if(['empty','filled'].includes(f.operator))return {...f};
    if(filterValues(f.field)&&!f.value.length)throw Error('请为每条筛选选择至少一个选项');
    if(['price','hours'].includes(f.field)&&(blank(f.value)||!Number.isFinite(Number(f.value))||Number(f.value)<0))throw Error('请填写有效的非负数值');
    if(['types','themes'].includes(f.field))return {...f,operator:'any'};
    if(f.field==='owned')return {...f,value:f.value.map(v=>v==='已购入')};
    return {...f};
  });
}
function categories() {
  $('#categoryTabs').innerHTML=['types','themes'].map(k=>`<button role="tab" aria-selected="${taxTab===k}" data-act="tax-tab" data-field="${k}">${k==='types'?'类型':'主题'}</button>`).join('');
  $('#categoryList').innerHTML=data().taxonomies[taxTab].map(v=>`<div class="category-item"><span></span><span class="category-item__name">${esc(v)}</span><span class="category-item__count">${data().games.filter(g=>g[taxTab].includes(v)).length} 处引用</span><button data-act="tax-rename" data-value="${esc(v)}" aria-label="重命名${esc(v)}">${svg('edit')}</button><button data-act="tax-delete" data-value="${esc(v)}" aria-label="删除${esc(v)}">${svg('trash')}</button></div>`).join('');
}
function migrateLabel(from,to) {
  data().games.forEach(g=>g[taxTab]=[...new Set(g[taxTab].map(v=>v===from?to:v).filter(Boolean))]);
  data().taxonomies[taxTab]=[...new Set(data().taxonomies[taxTab].map(v=>v===from?to:v).filter(Boolean))];
  data().view.filters=data().view.filters.map(f=>f.field===taxTab&&Array.isArray(f.value)?{...f,value:[...new Set(f.value.map(v=>v===from?to:v).filter(Boolean))]}:f).filter(f=>!Array.isArray(f.value)||f.value.length);
}
async function exportNow(prefix) {const payload=await createBackupPayload();downloadBackup(payload,prefix);app=await loadState();app.meta.lastBackupAt=payload.exportedAt;await persist();return payload}
async function click(e) {
  const b=e.target.closest('[data-act]');if(!b)return;e.preventDefault();const action=b.dataset.act;
  if(action==='choice') {readForm();const f=b.dataset.field,v=b.dataset.value;if(f==='rating')draft.rating=draft.rating===v?'':v;else{const values=draft[f];if(values.includes(v))draft[f]=values.filter(x=>x!==v);else{if(f==='types'&&values.length>=2)return toast('类型最多选择 2 个');values.push(v)}}queueDraft();render();return}
  if(action==='cancel')return cancel();
  if(action==='delete') {
    if(!await ask('删除游戏',`<p>删除“${esc(draft.name)}”？封面仍保留在完整备份中。</p>`,'删除游戏'))return;
    clearTimeout(timer);await clearDraft(draftKey());data().games=data().games.filter(g=>g.id!==draft.id);await persist();draft=null;dirty=false;openId=null;render();return toast('游戏已删除');
  }
  if(action==='filter-choice'){const f=tempFilters[Number(b.dataset.index)],v=b.dataset.value;f.value=f.value.includes(v)?f.value.filter(x=>x!==v):[...f.value,v];return filterRows()}
  if(action==='remove-temp'){tempFilters.splice(Number(b.dataset.index),1);return filterRows()}
  if(guarded())return;
  if(action==='new')return startNew();
  if(action==='open'){openId=b.dataset.id;openGroup=b.dataset.group;render();scrollStage();return}
  if(action==='close'){openId=openGroup=null;return render()}
  if(action==='edit'){if(!editing)return;draft=await loadDraft(openId)||structuredClone(data().games.find(g=>g.id===openId));isNew=false;dirty=false;return render()}
  if(action==='reset'){data().view.search='';data().view.filters=[];options()}
  if(action==='remove-filter')data().view.filters.splice(Number(b.dataset.index),1);
  if(action==='group'){const key=b.dataset.group;data().view.collapsedGroups=data().view.collapsedGroups.includes(key)?data().view.collapsedGroups.filter(k=>k!==key):[...data().view.collapsedGroups,key]}
  if(action==='tax-tab'){taxTab=b.dataset.field;return categories()}
  if(action==='tax-rename'){
    if(!editing)return;const from=b.dataset.value;
    if(!await ask('重命名标签',`<p>引用将同步更新；填写已有标签名会合并。</p><label><span>新名称</span><input id="taxName" value="${esc(from)}" maxlength="30"></label>`))return;
    const to=$('#taxName').value.trim();if(!to)return toast('标签名称不能为空');migrateLabel(from,to);
  }
  if(action==='tax-delete'){
    if(!editing)return;const from=b.dataset.value,required=taxTab==='types'&&data().games.some(g=>g.types.length===1&&g.types.includes(from));
    if(required)return toast('部分游戏只有这个类型。请先用重命名合并到另一类型，再删除。');
    if(!await ask('删除标签',`<p>删除“${esc(from)}”并清除游戏中的对应标签？</p>`,'删除标签'))return;migrateLabel(from,'');
  }
  await persist();render();if(action.startsWith('tax-'))categories();
}
function bind() {
  document.addEventListener('click',safe(click));
  document.addEventListener('input',e=>{if(e.target.closest('#gameEditor')){readForm();queueDraft()}if(e.target.matches('[data-filter-value]'))tempFilters[Number(e.target.closest('[data-filter]').dataset.filter)].value=e.target.value});
  document.addEventListener('change',safe(async e=>{if(e.target.id==='coverInput'&&e.target.files[0])await upload(e.target.files[0]);if(e.target.closest('#gameEditor')){readForm();queueDraft()}const row=e.target.closest('[data-filter]');if(row){const i=Number(row.dataset.filter);if(e.target.matches('[data-filter-field]'))tempFilters[i]=defaultFilter(e.target.value);if(e.target.matches('[data-filter-op]')){tempFilters[i].operator=e.target.value;tempFilters[i].value=filterValues(tempFilters[i].field)?[]:''}filterRows()}}));
  document.addEventListener('submit',safe(async e=>{if(e.target.id==='gameEditor'){e.preventDefault();await saveGame()}}));
  document.addEventListener('dragover',e=>{if(e.target.closest('.image-drop'))e.preventDefault()});
  document.addEventListener('drop',safe(async e=>{if(e.target.closest('.image-drop')){e.preventDefault();if(e.dataTransfer.files[0])await upload(e.dataTransfer.files[0])}}));
  document.addEventListener('paste',safe(async e=>{if(document.activeElement.closest('.image-drop')){const file=[...e.clipboardData.files].find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();await upload(file)}}}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawers();if((e.key==='Enter'||e.key===' ')&&e.target.matches('.image-drop')){e.preventDefault();$('#coverInput').click()}});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
  $('#addGameButton').onclick=safe(startNew);$('#editModeButton').onclick=safe(async()=>{if(!editing)await unlock()});
  $('#viewModeButton').onclick=()=>{if(guarded())return;editing=false;document.body.classList.remove('is-editing');render()};
  $('#pinForm').onsubmit=safe(async e=>{
    if(e.submitter?.value==='cancel')return;e.preventDefault();
    try{const pin=$('#pinInput').value,hash=await hashPin(pin);if($('#pinDialog').dataset.setup==='true'){if(pin!==$('#pinConfirmInput').value)throw Error('两次输入的密码不一致');app.security.pinHash=hash;await persist()}else if(hash!==app.security.pinHash)throw Error('密码不正确');editing=true;document.body.classList.add('is-editing');$('#pinDialog').close('ok');options();render()}catch(error){$('#pinError').textContent=error.message}
  });
  for(const [id,field] of [['groupSelect','groupBy'],['sortSelect','sortBy'],['searchInput','search']])$( `#${id}`)[id==='searchInput'?'oninput':'onchange']=safe(async e=>{if(guarded()){options();return}data().view[field]=e.target.value;if(field==='groupBy'){openId=null;data().view.collapsedGroups=[]}await persist();render()});
  $('#sortDirectionButton').onclick=safe(async()=>{if(guarded())return;data().view.sortDirection=data().view.sortDirection==='asc'?'desc':'asc';await persist();options();render()});
  $('#groupsButton').onclick=safe(async()=>{if(guarded())return;const keys=groupScreenGames(filtered(),data().view.groupBy,data().taxonomies).map(g=>g.key);data().view.collapsedGroups=keys.every(k=>data().view.collapsedGroups.includes(k))?[]:keys;await persist();render()});
  $('#filterButton').onclick=()=>{if(guarded())return;tempFilters=structuredClone(data().view.filters).map(f=>({...f,operator:f.operator==='any'?'in':f.operator,value:f.field==='owned'&&Array.isArray(f.value)?f.value.map(v=>v?'已购入':'未购入'):f.value}));filterRows();drawer('#filterDrawer')};
  $('#addFilterButton').onclick=()=>{const field=Object.keys(FILTER).find(k=>!tempFilters.some(f=>f.field===k));if(tempFilters.length<3&&field)tempFilters.push(defaultFilter(field));filterRows()};
  $('#clearFiltersButton').onclick=()=>{tempFilters=[];filterRows()};$('#applyFiltersButton').onclick=safe(async()=>{data().view.filters=appliedFilters();await persist();closeDrawers();render()});
  $('#categoryButton').onclick=()=>{if(!editing||guarded())return;categories();drawer('#categoryDrawer')};
  $('#addCategoryForm').onsubmit=safe(async e=>{e.preventDefault();if(!editing)return;const value=new FormData(e.target).get('label').trim();if(!value||data().taxonomies[taxTab].includes(value))return toast('名称为空或标签已存在');data().taxonomies[taxTab].push(value);await persist();e.target.reset();categories()});
  $('#backupButton').onclick=()=>{if(guarded())return;$('#backupStatus').textContent=app.meta.lastBackupAt?`最近备份：${new Date(app.meta.lastBackupAt).toLocaleString('zh-CN')}`:'尚未备份';drawer('#backupDrawer')};
  $('#exportButton').onclick=safe(async()=>{await exportNow();toast('一桌与一屏的完整备份已导出')});
  $('#importInput').onchange=safe(async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(!editing&&!await unlock())return;const payload=await readBackupFile(file),summary=summarizeBackup(payload);
      if(!await ask('恢复收藏备份',`<p>桌游 ${summary.games} 款 · 扩展 ${summary.expansions} 个 · 电子游戏 ${summary.screenGames} 款 · 图片 ${summary.images} 张</p><p>${payload.hasScreenData?'将替换一桌和一屏的收藏。':'这是旧版桌游备份，现有电子游戏及其封面将保留。'}恢复前将自动导出当前完整备份。</p>`,'恢复备份'))return;
      await exportNow('一桌一屏-恢复前自动备份');app=await restoreBackup(payload);editing=false;document.body.classList.remove('is-editing');openId=null;closeDrawers();options();render();toast('备份已恢复，编辑模式已锁定');
    }finally{e.target.value=''}
  });
  $('#drawerScrim').onclick=closeDrawers;$$('[data-close-drawer]').forEach(b=>b.onclick=closeDrawers);
}
async function init(){app=await loadState();options();bind();render();if(await loadDraft('screen-new'))toast('有一份未完成的新游戏草稿，点击“添加游戏”可继续')}
init().catch(error=>{$('#collection').innerHTML=`<div class="empty-collection"><div><h2>收藏无法载入</h2><p>${esc(error.message)}</p></div></div>`;console.error(error)});
