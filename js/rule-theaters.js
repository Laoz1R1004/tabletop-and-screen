// Add a published theater here when another game receives its own lesson.
const theaters = [
  {name: /^(?:现代艺术|現代藝術|modern\s+art)(?=$|[\s（(·:/\-])/i, href: 'modern-art.html', edition: 'CMON 版 · 四人讲解'}
];

export function ruleTheaterFor(game) {
  if (game.itemType === 'collection' || /卡牌|card\s*game/i.test(`${game.name} ${game.version || ''}`)) return null;
  return theaters.find(theater => theater.name.test(String(game.name || '').trim())) || null;
}
