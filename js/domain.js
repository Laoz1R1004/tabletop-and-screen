const DEFAULT_TAXONOMIES = {
  itemType: ["桌游", "收藏类"],
  collectionType: ["花切扑克", "塔罗牌", "其他"],
  designSchool: ["美式", "德式", "毛线", "混合", "社交"],
  mechanisms: ["DBG", "PBG", "吹牛", "赌博", "身份", "推理", "拍卖", "成套收集", "板块放置", "工人放置", "类棋牌", "轮抽", "区域控制", "谈判", "骰子放置", "线路搭建", "行动编程", "引擎构筑", "RPG", "手牌管理", "非对称", "传承"],
  interaction: ["个人竞争", "团队竞争", "合作", "半合作"],
  themes: []
};

const isBlank = (value) => value === null || value === undefined || value === "";
const numberInRange = (value, min, max) => isBlank(value) || (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max);

export function createDefaultState() {
  return {
    games: [],
    taxonomies: structuredClone(DEFAULT_TAXONOMIES),
    view: {
      groupBy: "designSchool",
      sortBy: "weight",
      sortDirection: "asc",
      filters: [],
      search: "",
      collapsedGroups: []
    },
    security: { pinHash: null },
    meta: { lastBackupAt: null, updatedAt: new Date().toISOString() }
  };
}

export function validateGame(game) {
  const errors = {};
  const isCollection = game.itemType === "collection";
  if (!game.name?.trim()) errors.name = "请输入桌游名称";
  if (!game.coverId) errors.coverId = "请上传桌游封面";
  if (!isCollection && !game.version?.trim()) errors.version = "请输入所属版本";
  if (!isCollection && !game.designSchool) errors.designSchool = "请选择设计流派";
  if (isCollection && !game.collectionType) errors.collectionType = "请选择收藏子类";
  if (!numberInRange(game.price, 0, Number.MAX_SAFE_INTEGER)) errors.price = "购入价不能小于 0";
  if (!isCollection && !numberInRange(game.weight, 0, 5)) errors.weight = "BGG 重度应在 0–5 之间";
  if (!isCollection && !numberInRange(game.rating, 0, 10)) errors.rating = "个人评分应在 0–10 之间";
  if (!isCollection && !isBlank(game.plays) && (!Number.isInteger(Number(game.plays)) || Number(game.plays) < 0)) errors.plays = "开局数应为非负整数";
  if (!isCollection && (
    (isBlank(game.playerMin) && !isBlank(game.playerMax)) ||
    (!isBlank(game.playerMin) && isBlank(game.playerMax)) ||
    (!isBlank(game.playerMin) && (
      !Number.isInteger(Number(game.playerMin)) ||
      !Number.isInteger(Number(game.playerMax)) ||
      Number(game.playerMin) < 1 ||
      Number(game.playerMax) < Number(game.playerMin)
    ))
  )) {
    errors.playerRange = "请成对填写有效的推荐人数范围";
  }
  if ((game.mechanisms?.length ?? 0) > 3) errors.mechanisms = "设计机制最多选择 3 个";
  return errors;
}

export function validateExpansion(expansion) {
  const errors = {};
  if (!expansion.name?.trim()) errors.name = "请输入扩展名称";
  if (!expansion.coverId) errors.coverId = "请上传扩展封面";
  if (!numberInRange(expansion.price, 0, Number.MAX_SAFE_INTEGER)) errors.price = "购入价不能小于 0";
  if (!numberInRange(expansion.rating, 0, 10)) errors.rating = "个人评分应在 0–10 之间";
  return errors;
}

function sortableValue(game, field) {
  if (field === "name") return game.name ?? "";
  return game[field];
}

export function sortGames(games, field, direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...games].sort((a, b) => {
    const av = sortableValue(a, field);
    const bv = sortableValue(b, field);
    const aBlank = isBlank(av);
    const bBlank = isBlank(bv);
    if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv), "zh-Hans-CN", { numeric: true }) * multiplier;
    }
    return (Number(av) - Number(bv)) * multiplier;
  });
}

function groupValues(game, field) {
  if (field === "mechanisms" || field === "themes") return game[field]?.length ? game[field] : ["__empty"];
  if (field === "designSchool" && game.itemType === "collection") return ["收藏"];
  if (field === "itemType") return [game.itemType === "collection" ? "收藏类" : "桌游"];
  if (field === "collectionType") return [game.collectionType || "__empty"];
  if (field === "owned") return [isBlank(game.price) ? "未购入" : "已购入"];
  if (field === "rated") return [isBlank(game.rating) ? "未评分" : "已评分"];
  if (field === "hasExpansions") return [game.expansions?.length ? "有扩展" : "无扩展"];
  return [game[field] || "__empty"];
}

export function buildGroups(games, field, taxonomies = {}) {
  const map = new Map();
  games.forEach((game) => groupValues(game, field).forEach((key) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(game);
  }));
  const preferred = taxonomies[field] ?? [];
  const index = new Map(preferred.map((item, position) => [item, position]));
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "__empty") return 1;
      if (b === "__empty") return -1;
      const ai = index.has(a) ? index.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b) ? index.get(b) : Number.MAX_SAFE_INTEGER;
      return ai === bi ? String(a).localeCompare(String(b), "zh-Hans-CN", { numeric: true }) : ai - bi;
    })
    .map(([key, groupedGames]) => ({ key, games: groupedGames }));
}

function matchFilter(game, { field, operator, value }) {
  let actual = game[field];
  if (field === "itemType") actual = game.itemType === "collection" ? "收藏类" : "桌游";
  if (field === "owned") actual = !isBlank(game.price);
  if (field === "rated") actual = !isBlank(game.rating);
  if (field === "hasExpansions") actual = Boolean(game.expansions?.length);
  if (operator === "empty") return isBlank(actual) || Array.isArray(actual) && actual.length === 0;
  if (operator === "filled") return !isBlank(actual) && (!Array.isArray(actual) || actual.length > 0);
  if (operator === "eq") return actual === value || String(actual) === String(value);
  if (operator === "neq") return actual !== value && String(actual) !== String(value);
  if (operator === "gte") return !isBlank(actual) && Number(actual) >= Number(value);
  if (operator === "lte") return !isBlank(actual) && Number(actual) <= Number(value);
  if (operator === "between") return !isBlank(actual) && Number(actual) >= Number(value?.[0]) && Number(actual) <= Number(value?.[1]);
  if (operator === "contains") return String(actual ?? "").toLocaleLowerCase().includes(String(value ?? "").toLocaleLowerCase());
  if (operator === "any") return value?.some((item) => actual?.includes?.(item));
  if (operator === "all") return value?.every((item) => actual?.includes?.(item));
  if (operator === "in") return value?.includes(actual);
  return true;
}

export function applyFilters(games, filters = []) {
  if (filters.length > 3) throw new Error("最多添加 3 条筛选");
  if (new Set(filters.map(({ field }) => field)).size !== filters.length) throw new Error("筛选字段不能重复");
  return games.filter((game) => filters.every((filter) => matchFilter(game, filter)));
}

export function searchGames(games, query) {
  const needle = query?.trim().toLocaleLowerCase();
  if (!needle) return games;
  return games.filter((game) => [
    game.name,
    game.version,
    game.notes,
    ...(game.themes ?? []),
    ...(game.expansions ?? []).flatMap((expansion) => [expansion.name, expansion.notes])
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)));
}

export function normalizeBackup(input) {
  if (input?.format !== "tabletop-and-screen" || input.version !== 1 || !input.state) throw new Error("无法识别的备份文件");
  const defaults = createDefaultState();
  return {
    format: input.format,
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    state: {
      ...defaults,
      ...input.state,
      games: input.state.games ?? [],
      taxonomies: { ...defaults.taxonomies, ...input.state.taxonomies },
      view: { ...defaults.view, ...input.state.view },
      security: { ...defaults.security, ...input.state.security },
      meta: { ...defaults.meta, ...input.state.meta }
    },
    images: Array.isArray(input.images) ? input.images : []
  };
}

export async function hashPin(pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error("请输入 6 位数字密码");
  const bytes = new TextEncoder().encode(pin);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeId(prefix = "item") {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export function emptyGame() {
  const now = new Date().toISOString();
  return {
    id: makeId("game"),
    itemType: "tabletop",
    collectionType: "",
    name: "",
    coverId: "",
    version: "",
    price: null,
    weight: null,
    rating: null,
    plays: null,
    notes: "",
    designSchool: "",
    mechanisms: [],
    playerMin: null,
    playerMax: null,
    themes: [],
    interaction: "",
    expansions: [],
    createdAt: now,
    updatedAt: now
  };
}
