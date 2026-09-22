export const RATINGS = ['S', 'S-', 'A', 'A-', 'B'];
export const PLATFORMS = ['PC端', 'Pad端', '手机端', '主机端'];
export const PROGRESS = ['已通关', '深入游玩', '刚刚接触', '未游玩'];
export const blank = v => v === null || v === undefined || v === '';
export const themeTags = text => [...new Set(text.split(/[，,]/).map(v => v.trim()).filter(Boolean))];

export function defaultScreen() {
  return { games: [], taxonomies: { types: ['策略类','动作类','解谜类','恐怖类','经营类','剧情类','聚会类','模拟器','体育类','肉鸽类','沙盒类','射击类','休闲类','RPG类','战略类'], themes: [] },
    view: { groupBy: 'types', sortBy: 'rating', sortDirection: 'asc', filters: [], search: '', collapsedGroups: [] } };
}
export function emptyScreenGame() {
  const now = new Date().toISOString();
  return { id: `screen-${crypto.randomUUID()}`, name: '', coverId: '', price: null, rating: '', progress: '未游玩', types: [], themes: [], platform: '', hours: null, developer: '', notes: '', createdAt: now, updatedAt: now };
}
export function normalizeHours(v) { return blank(v) ? null : Number(v) > 0 && Number(v) < 1 ? 1 : Number(Number(v).toFixed(1)); }
export function formatHours(v) { return blank(v) ? '未记录' : `${normalizeHours(v).toFixed(1)} 小时`; }
export function validateScreenGame(g) {
  const errors = {};
  if (!g.name?.trim()) errors.name = '请输入游戏名称';
  if (!g.coverId) errors.coverId = '请上传游戏封面';
  if (!Array.isArray(g.types) || g.types.length < 1 || g.types.length > 2 || new Set(g.types).size !== g.types.length) errors.types = '请选择 1–2 个不同类型';
  if (!PLATFORMS.includes(g.platform)) errors.platform = '请选择一个主平台';
  if (!blank(g.rating) && !RATINGS.includes(g.rating)) errors.rating = '请选择 S、S-、A、A- 或 B';
  if (!PROGRESS.includes(g.progress)) errors.progress = '请选择游戏进度';
  for (const k of ['price', 'hours']) if (!blank(g[k]) && (!Number.isFinite(Number(g[k])) || Number(g[k]) < 0)) errors[k] = `${k === 'price' ? '购入价' : '游戏时长'}应为非负数字`;
  return errors;
}
export function sortScreenGames(games, field = 'rating', direction = 'asc') {
  const name = (a,b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  return [...games].sort((a,b) => {
    const av=a[field], bv=b[field];
    if (blank(av) || blank(bv)) return blank(av) === blank(bv) ? name(a,b) : blank(av) ? 1 : -1;
    const diff = field === 'rating' ? RATINGS.indexOf(av)-RATINGS.indexOf(bv) : typeof av === 'number' ? av-bv : String(av).localeCompare(String(bv),'zh-Hans-CN',{numeric:true});
    return diff * (direction === 'desc' ? -1 : 1) || name(a,b);
  });
}
export function screenGroupKeys(g, field) {
  if (field === 'types' || field === 'themes') return g[field]?.length ? [...new Set(g[field])] : ['__empty'];
  if (field === 'owned') return [blank(g.price) ? '未购入' : '已购入'];
  return [g[field] || '__empty'];
}
export function groupScreenGames(games, field, taxonomies) {
  const map = new Map(), order = ({rating:RATINGS, platform:PLATFORMS, progress:PROGRESS})[field] || taxonomies[field] || [];
  games.forEach(g => screenGroupKeys(g,field).forEach(k => {if (!map.has(k)) map.set(k,[]);map.get(k).push(g)}));
  const rank = k => order.includes(k) ? order.indexOf(k) : order.length;
  return [...map].sort(([a],[b]) => a === '__empty' ? 1 : b === '__empty' ? -1 : rank(a)-rank(b) || a.localeCompare(b,'zh-Hans-CN')).map(([key,games])=>({key,games}));
}
export function searchScreenGames(games, query) {
  const q = query.trim().toLocaleLowerCase();
  return games.filter(g => [g.name,g.developer,g.notes,...g.types,...g.themes].some(v => String(v || '').toLocaleLowerCase().includes(q)));
}
