export function cloudState(state) {
  return structuredClone({games:state.games, taxonomies:state.taxonomies,
    security:state.security, sessions:state.sessions || [],
    screen:{games:state.screen.games, wishlist:state.screen.wishlist || [],
      priorityPlayIds:state.screen.priorityPlayIds || [], taxonomies:state.screen.taxonomies}});
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const same = (a,b) => canonical(a) === canonical(b);
export function mergeImages(base, local, remote) {
  const bm=new Map(base.map(i=>[i.id,i])), lm=new Map(local.map(i=>[i.id,i])), rm=new Map(remote.map(i=>[i.id,i]));
  const images=[],conflicts=[];
  for(const id of new Set([...bm.keys(),...lm.keys(),...rm.keys()])) {
    const b=bm.get(id),l=lm.get(id),r=rm.get(id);
    const chosen=same(l,r)||same(b,r) ? l : same(b,l) ? r : undefined;
    if(!same(l,r) && !same(b,r) && !same(b,l))conflicts.push(`封面/${id}`);
    if(chosen)images.push(chosen);
  }
  return {images,conflicts};
}
export function coverIds(state) {
  return [...new Set([...state.games, ...state.screen.games]
    .flatMap(game=>[game.coverId,...(game.expansions || []).map(e=>e.coverId)]).filter(Boolean))];
}
export function counts(state) {
  return `桌上 ${state.games.length} · 游戏 ${state.screen.games.length} · 愿望 ${state.screen.wishlist.length} · 桌游局 ${(state.sessions || []).length}`;
}

// Three-way merge by stable record ID. A conflicting record stays intact on both sides.
export function mergeCloud(base, local, remote) {
  const conflicts = [];
  function pick(b,l,r,path) {
    if (same(l,r) || same(r,b)) return structuredClone(l);
    if (same(l,b)) return structuredClone(r);
    conflicts.push(path); return structuredClone(l);
  }
  function records(b,l,r,path) {
    const bm = new Map(b.map(x=>[x.id,x])), lm=new Map(l.map(x=>[x.id,x])), rm=new Map(r.map(x=>[x.id,x]));
    return [...new Set([...l.map(x=>x.id),...r.map(x=>x.id),...b.map(x=>x.id)])]
      .map(id=>pick(bm.get(id),lm.get(id),rm.get(id),`${path}/${id}`)).filter(x=>x!==undefined);
  }
  const state={games:records(base.games,local.games,remote.games,'桌上收藏'),
    sessions:records(base.sessions,local.sessions,remote.sessions,'桌游局'),
    taxonomies:pick(base.taxonomies,local.taxonomies,remote.taxonomies,'桌上分类'),
    security:pick(base.security,local.security,remote.security,'编辑密码'),
    screen:{games:records(base.screen.games,local.screen.games,remote.screen.games,'游戏收藏'),
      wishlist:records(base.screen.wishlist,local.screen.wishlist,remote.screen.wishlist,'愿望单'),
      taxonomies:pick(base.screen.taxonomies,local.screen.taxonomies,remote.screen.taxonomies,'游戏分类'),
      priorityPlayIds:pick(base.screen.priorityPlayIds,local.screen.priorityPlayIds,remote.screen.priorityPlayIds,'最近优先玩')}};
  // A game removed on either side cannot remain as a dangling priority entry.
  const ids=new Set(state.screen.games.map(g=>g.id));
  state.screen.priorityPlayIds=state.screen.priorityPlayIds.filter(id=>ids.has(id));
  return {state,conflicts};
}
