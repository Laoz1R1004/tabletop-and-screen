import { createDefaultState, makeId, normalizeBackup } from "./domain.js";

const DB_NAME = "tabletop-and-screen";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = action(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(result?.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function loadState() {
  const state = await transact("state", "readonly", (store) => store.get("app"));
  if (!state) {
    const fresh = createDefaultState();
    await saveState(fresh);
    return fresh;
  }
  return normalizeBackup({ format: "tabletop-and-screen", version: 1, state, images: [] }).state;
}

export function mergeSavedState(current, state, scope = 'tabletop') {
  if (!current) return structuredClone(state);
  const next = structuredClone(current);
  const fields = scope === 'screen' ? ['screen'] : ['games', 'taxonomies', 'view'];
  for (const field of fields) next[field] = structuredClone(state[field]);
  next.security = structuredClone(current.security?.pinHash ? current.security : state.security);
  next.meta = { ...current.meta, ...state.meta, lastBackupAt: [current.meta?.lastBackupAt, state.meta?.lastBackupAt].filter(Boolean).sort().at(-1) || null };
  return next;
}

export async function saveState(state, scope = 'tabletop') {
  state.meta = { ...state.meta, updatedAt: new Date().toISOString() };
  await transact("state", "readwrite", (store) => {
    const read = store.get('app');
    read.onsuccess = () => store.put(mergeSavedState(read.result, state, scope), 'app');
  });
  return state;
}

export const loadDraft = (id) => transact("drafts", "readonly", (store) => store.get(id));
export const saveDraft = (id, draft) => transact("drafts", "readwrite", (store) => store.put(structuredClone(draft), id));
export const clearDraft = (id) => transact("drafts", "readwrite", (store) => store.delete(id));

export async function createThumbnail(file, maxSize = 720) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("无法生成封面缩略图")),
    "image/webp",
    0.84
  ));
}

export async function putImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
  const id = makeId("image");
  const thumbnail = await createThumbnail(file);
  await transact("images", "readwrite", (store) => store.put({
    id,
    name: file.name || "cover",
    type: file.type,
    original: file,
    thumbnail
  }));
  return id;
}

export async function getImage(id, size = "thumbnail") {
  if (!id) return null;
  const record = await transact("images", "readonly", (store) => store.get(id));
  return record?.[size] ?? record?.original ?? null;
}

export const deleteImage = (id) => id ? transact("images", "readwrite", (store) => store.delete(id)) : Promise.resolve();

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(data) {
  const response = await fetch(data);
  return response.blob();
}

export function makeBackupPayload(state, images, exportedAt = new Date().toISOString()) {
  return { format: "tabletop-and-screen", version: 1, exportedAt, state: structuredClone(state), images };
}

export function summarizeBackup(payload) {
  return {
    exportedAt: payload.exportedAt,
    games: payload.state.games.length,
    expansions: payload.state.games.reduce((total, game) => total + (game.expansions?.length ?? 0), 0),
    images: payload.images.length,
    screenGames: payload.state.screen?.games.length ?? 0
  };
}

export async function createBackupPayload(state) {
  state = await loadState();
  const records = await transact("images", "readonly", (store) => store.getAll());
  const images = await Promise.all((records ?? []).map(async ({ id, name, type, original }) => ({
    id,
    name,
    type,
    data: await blobToDataUrl(original)
  })));
  return makeBackupPayload(state, images);
}

export function downloadBackup(payload, prefix = "一桌一屏-备份") {
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function readBackupFile(file) {
  const parsed = JSON.parse(await file.text());
  return normalizeBackup(parsed);
}

export async function restoreBackup(payload) {
  const normalized = normalizeBackup(payload);
  let imageRecords = await Promise.all(normalized.images.map(async (image) => {
    const original = await dataUrlToBlob(image.data);
    return {
      id: image.id,
      name: image.name,
      type: image.type,
      original,
      thumbnail: await createThumbnail(original)
    };
  }));
  if (!normalized.hasScreenData) {
    const current = await loadState();
    const records = await transact('images', 'readonly', store => store.getAll());
    const preserved = preserveScreenOnLegacyRestore(normalized.state, current, imageRecords, records);
    normalized.state = preserved.state;
    imageRecords = preserved.images;
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["state", "images", "drafts"], "readwrite");
    const stateStore = transaction.objectStore("state");
    const imageStore = transaction.objectStore("images");
    transaction.objectStore("drafts").clear();
    stateStore.clear();
    imageStore.clear();
    stateStore.put(normalized.state, "app");
    imageRecords.forEach((image) => imageStore.put(image));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return normalized.state;
}

export function preserveScreenOnLegacyRestore(incoming, current, images, currentImages) {
  const state = structuredClone(incoming);
  state.screen = structuredClone(current.screen);
  const result = [...images], existing = new Set(images.map(i=>i.id));
  for (const coverId of new Set(state.screen.games.map(g=>g.coverId).filter(Boolean))) {
    const record = currentImages.find(i=>i.id===coverId);
    if (!record) throw new Error('现有电子游戏封面缺失，已取消恢复');
    const id = existing.has(coverId) ? makeId('image') : coverId;
    state.screen.games.forEach(g=>{if(g.coverId===coverId)g.coverId=id});
    result.push({...record,id}); existing.add(id);
  }
  return {state, images:result};
}
