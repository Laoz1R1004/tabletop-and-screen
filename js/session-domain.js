// Pure session rules. No database or DOM dependencies.
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const SESSION_STATUSES = ['计划中', '进行中', '已完成'];
export const ITEM_STATUSES = ['未开始', '进行中', '已完成', '跳过'];
export const SESSION_THEMES = ['聚会', '推新', '深度', '轻松', '双人', '家庭'];
export const sessionItems = session => session.phases.flatMap(phase => phase.items);
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function createPhase(name = '新阶段') { return {id:id('phase'), name, items:[]}; }
export function createSession(date = localDate()) {
  return {id:id('session'), title:'', date, theme:'聚会', players:4, status:'计划中',
    phases:['热场','轻度','重度'].map(createPhase), notes:'', revision:0, createdAt:new Date().toISOString()};
}
export function addSessionGame(session, phaseId, game, cover = '') {
  if (game.itemType === 'collection') throw Error('收藏类藏品不能加入桌游局');
  if (sessionItems(session).some(item => item.gameId === game.id)) throw Error('同一桌游不能重复加入，请修改计划局数');
  const phase = session.phases.find(p=>p.id===phaseId);
  if (!phase) throw Error('阶段不存在');
  const snapshot = structuredClone({name:game.name,version:game.version || '',cover,
    weight:game.weight ?? null,rating:game.rating ?? null,designSchool:game.designSchool || '',
    mechanisms:game.mechanisms || [],playerMin:game.playerMin ?? null,playerMax:game.playerMax ?? null});
  const item = {id:id('slot'),gameId:game.id,snapshot,planned:1,actual:0,minutes:null,status:'未开始',notes:'',synced:0};
  phase.items.push(item); return item;
}
export function moveItem(session, itemId, targetPhaseId, index) {
  const source=session.phases.find(p=>p.items.some(i=>i.id===itemId));
  const target=session.phases.find(p=>p.id===targetPhaseId);
  if (!source || !target) throw Error('找不到要移动的桌游或阶段');
  const [item]=source.items.splice(source.items.findIndex(i=>i.id===itemId),1);
  target.items.splice(Math.max(0,Math.min(index,target.items.length)),0,item);
}
export function sessionTitle(s) { return s.title.trim() || `${s.date} · ${s.theme}`; }
export function sortSessions(sessions) { return [...sessions].sort((a,b)=>b.date.localeCompare(a.date) || (b.createdAt||'').localeCompare(a.createdAt||'')); }
export function sessionSummary(session) {
  const items=sessionItems(session);
  return {games:items.length,planned:items.reduce((n,i)=>n+i.planned,0),actual:items.reduce((n,i)=>n+i.actual,0),
    minutes:items.reduce((n,i)=>n+i.planned*(i.minutes||0),0),untimed:items.filter(i=>!i.minutes).length};
}
export function validateSession(s) {
  const errors=[];
  const integer=(n,min)=>Number.isSafeInteger(n)&&n>=min&&n<=100000;
  if (!s || typeof s.id!=='string' || !s.id || !Array.isArray(s.phases)) return ['桌游局结构不完整'];
  if (typeof s.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(Date.parse(s.date)) || new Date(s.date).toISOString().slice(0,10)!==s.date) errors.push('请选择有效日期');
  if (typeof s.title!=='string' || s.title.length>120) errors.push('标题最多 120 字');
  if (typeof s.theme!=='string' || !s.theme.trim() || s.theme.length>40) errors.push('请填写 1–40 字主题');
  if (!integer(s.players,1)) errors.push('人数必须是正整数');
  if (!SESSION_STATUSES.includes(s.status)) errors.push('桌游局状态无效');
  if (typeof s.notes!=='string') errors.push('感想应为文字');
  if (!Number.isSafeInteger(s.revision) || s.revision<0) errors.push('桌游局修订号无效');
  const games=new Set(),ids=new Set();
  if (!s.phases.length) errors.push('请至少保留一个阶段');
  for (const phase of s.phases) {
    if (!phase || typeof phase.id!=='string' || ids.has(phase.id) || typeof phase.name!=='string' || !phase.name.trim() || phase.name.length>40 || !Array.isArray(phase.items)) { errors.push('阶段名称或结构无效'); continue; }
    ids.add(phase.id);
    for (const item of phase.items) {
      if (!item || typeof item.id!=='string' || ids.has(item.id) || typeof item.gameId!=='string' || !item.gameId) { errors.push('桌游条目结构无效');continue; }
      ids.add(item.id);
      if (games.has(item.gameId)) errors.push('同一桌游不能重复加入');
      games.add(item.gameId);
      if (!item.snapshot || typeof item.snapshot.name!=='string' || !item.snapshot.name.trim() || typeof item.snapshot.version!=='string' || typeof item.snapshot.cover!=='string') errors.push('桌游快照不完整');
      if (!integer(item.planned,1) || !integer(item.actual,0) || !integer(item.synced,0)) errors.push('计划局数为正整数，实玩局数为非负整数');
      if (item.actual<item.synced) errors.push('实玩局数不能少于已同步局数');
      if (item.minutes!==null && !integer(item.minutes,1)) errors.push('每局预估分钟必须为正整数或留空');
      if (!ITEM_STATUSES.includes(item.status) || typeof item.notes!=='string') errors.push('桌游状态或感想无效');
    }
  }
  return [...new Set(errors)];
}
export function syncSessionPlays(state, sessionId) {
  const s=state.sessions.find(s=>s.id===sessionId);
  if (!s) throw Error('桌游局不存在');
  const errors=validateSession(s); if (errors.length) throw Error(errors.join('；'));
  const updates=sessionItems(s).filter(i=>i.actual>i.synced).map(item=>{
    const game=state.games.find(g=>g.id===item.gameId && g.itemType!=='collection');
    if (!game) throw Error(`「${item.snapshot.name}」在收藏中已不存在，未同步任何数据`);
    return {game,item,delta:item.actual-item.synced};
  });
  for (const {game,item,delta} of updates) {
    // Existing collection intentionally displays any value above five as 常开.
    game.plays=Number(game.plays||0)+delta; game.updatedAt=new Date().toISOString();item.synced=item.actual;
  }
  return updates.reduce((n,u)=>n+u.delta,0);
}
