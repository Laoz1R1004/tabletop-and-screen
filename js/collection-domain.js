export const COLLECTION_TYPES = ['扑克', '占卜', '骰子'];
const LEGACY_TYPES = {'花切扑克':'扑克', '塔罗牌':'占卜', '其他':''};

// Shared by local reads, backups and cloud comparisons; migration is idempotent.
export function normalizeCollections(state) {
  const next = structuredClone(state);
  next.games = (next.games || []).map(game => {
    if (game.itemType !== 'collection') return game;
    return {...game, brand:game.brand ?? '', collectionType:LEGACY_TYPES[game.collectionType] ?? game.collectionType ?? ''};
  });
  if (next.taxonomies) {
    const types = next.taxonomies.collectionType || COLLECTION_TYPES;
    const legacy = types.some(type => Object.hasOwn(LEGACY_TYPES, type));
    next.taxonomies.collectionType = [...new Set(types.map(type => LEGACY_TYPES[type] ?? type).filter(Boolean).concat(legacy ? COLLECTION_TYPES : []))];
  }
  if (next.view?.filters) next.view.filters = next.view.filters.map(filter => {
    if (filter.field !== 'collectionType') return filter;
    if (filter.value === '其他') return {...filter, operator:'empty', value:''};
    return {...filter, value:LEGACY_TYPES[filter.value] ?? filter.value};
  });
  return next;
}
