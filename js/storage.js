import { createDefaultState, makeId, normalizeBackup } from "./domain.js";
import {validateSession, sessionItems, syncSessionPlays} from './session-domain.js';
import {cloudState, same, mergeCloud} from './cloud-domain.js';

const DB_NAME = "tabletop-and-screen";
const DB_VERSION = 1;
const loadedPlays = new WeakMap();
const loadedSnapshots = new WeakMap();
function collectionChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tts-local-save'));
}
function touchLocalRevision(store) {
  const read=store.get('local-revision');
  read.onsuccess=()=>store.put((read.result || 0)+1,'local-revision');
}
function rememberPlays(state) {
  loadedPlays.set(state,new Map(state.games.map(game=>[game.id,game.plays])));
  loadedSnapshots.set(state,cloudState(state));
  return state;
}

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
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(transaction.error || Error('保存已取消，本地数据保持不变'));
    };
  });
}

export async function loadState() {
  const state = await transact("state", "readonly", (store) => store.get("app"));
  if (!state) {
    const fresh = createDefaultState();
    await saveState(fresh);
    return rememberPlays(fresh);
  }
  return rememberPlays(normalizeBackup({ format: "tabletop-and-screen", version: 1, state, images: [] }).state);
}

export function mergeSavedState(current, state, scope = 'tabletop', baselinePlays, baseline) {
  if (!current) return structuredClone(state);
  const next = structuredClone(current);
  const fields = scope === 'screen' ? ['screen'] : ['games', 'taxonomies', 'view'];
  for (const field of fields) next[field] = structuredClone(state[field]);
  if (scope === 'tabletop') for (const game of next.games) {
    const latest = current.games?.find(g=>g.id===game.id);
    if (latest && (baselinePlays?.has(game.id) ? baselinePlays.get(game.id) === game.plays : latest.updatedAt > game.updatedAt)) game.plays = latest.plays;
  }
  next.security = structuredClone(current.security?.pinHash ? current.security : state.security);
  next.meta = { ...current.meta, ...state.meta, lastBackupAt: [current.meta?.lastBackupAt, state.meta?.lastBackupAt].filter(Boolean).sort().at(-1) || null };
  if(baseline) {
    const base=structuredClone(baseline), candidate=structuredClone(baseline);
    if(scope==='screen')candidate.screen=cloudState(next).screen;
    else {
      candidate.games=structuredClone(next.games);candidate.taxonomies=structuredClone(next.taxonomies);
      // Preserve the existing session-to-play-count merge when it is the only remote change.
      for(const old of base.games) {
        const latest=current.games.find(g=>g.id===old.id), local=candidate.games.find(g=>g.id===old.id);
        if(!latest||!local || baselinePlays?.get(old.id)!==state.games.find(g=>g.id===old.id)?.plays)continue;
        const omit=g=>{const copy={...g};delete copy.plays;delete copy.updatedAt;return copy;};
        if(same(omit(old),omit(latest))) {Object.assign(old,structuredClone(latest));local.plays=latest.plays;}
      }
    }
    candidate.security=structuredClone(state.security);
    const merged=mergeCloud(base,candidate,cloudState(current));
    if(merged.conflicts.length)throw Error('收藏已在其他窗口修改。请保留草稿，重新打开后再保存。');
    Object.assign(next,merged.state,{screen:{...next.screen,...merged.state.screen}});
  }
  return next;
}

export async function saveState(state, scope = 'tabletop') {
  state.meta = { ...state.meta, updatedAt: new Date().toISOString() };
  let saved, failure;
  try {await transact("state", "readwrite", (store) => {
    const read = store.get('app');
    read.onsuccess = () => {
      try {
        saved=mergeSavedState(read.result, state, scope, loadedPlays.get(state),loadedSnapshots.get(state));
        store.put(saved, 'app');
        touchLocalRevision(store);
      } catch(error) {failure=error;store.transaction.abort();}
    };
  });} catch(error) {throw failure || error;}
  if(scope==='tabletop')for(const game of state.games)game.plays=saved.games.find(g=>g.id===game.id)?.plays ?? game.plays;
  for(const field of ['games','taxonomies','security','screen','sessions'])state[field]=structuredClone(saved[field]);
  rememberPlays(state);
  collectionChanged();
  return state;
}

export const loadDraft = (id) => transact("drafts", "readonly", (store) => store.get(id));
export const saveDraft = (id, draft) => transact("drafts", "readwrite", (store) => store.put(structuredClone(draft), id));
export const clearDraft = (id) => transact("drafts", "readwrite", (store) => store.delete(id));

export async function createThumbnail(file, maxSize = 720) {
  const canvas = document.createElement("canvas");
  let source, url;
  try {
    if (typeof globalThis.createImageBitmap === 'function') {
      try { source = await createImageBitmap(file); } catch { /* Native images support some formats bitmap decoding does not. */ }
    }
    if (!source) {
      url = URL.createObjectURL(file);
      source = new Image();
      await new Promise((resolve, reject) => {
        source.onload = resolve;
        source.onerror = () => reject(new Error('无法读取封面图片，请检查备份中的图片是否完整'));
        source.src = url;
      });
    }
    const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("无法生成封面缩略图")),
      "image/webp", 0.84
    ));
  } finally {
    source?.close?.();
    if (url) { source.src = ''; URL.revokeObjectURL(url); }
    canvas.width = canvas.height = 0;
  }
}

export async function putImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
  const id = makeId("image");
  const thumbnail = await createThumbnail(file);
  await mutateImages((store) => store.put({
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

export const deleteImage = (id) => id ? mutateImages(store=>store.delete(id)) : Promise.resolve();
async function mutateImages(action) {
  const db=await openDb();
  try {await new Promise((resolve,reject)=>{
    const tx=db.transaction(['images','state'],'readwrite');
    action(tx.objectStore('images'));touchLocalRevision(tx.objectStore('state'));
    tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error || Error('图片保存失败'));
  });} finally {db.close();}
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(data) {
  const match = typeof data === 'string' && /^data:(image\/[^;,]+);base64,([\s\S]*)$/.exec(data);
  if (!match) throw new Error('备份中的封面数据格式无效，原收藏未修改');
  let binary;
  try { binary = atob(match[2]); } catch { throw new Error('备份中的封面数据不完整，原收藏未修改'); }
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes], {type:match[1]});
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
    screenGames: payload.state.screen?.games.length ?? 0,
    wishlist: payload.state.screen?.wishlist?.length ?? 0,
    sessions: payload.state.sessions?.length ?? 0
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

export async function restoreBackup(payload, onProgress = () => {}) {
  const normalized = normalizeBackup(payload);
  let imageRecords = [];
  onProgress({done:0,total:normalized.images.length});
  // Restoring bytes must not depend on a device's image decoder.
  // Use the original for display too; newly uploaded images still get thumbnails.
  for (const image of normalized.images) {
    const original = await dataUrlToBlob(image.data);
    imageRecords.push({
      id: image.id,
      name: image.name,
      type: image.type,
      original,
      thumbnail: original
    });
    onProgress({done:imageRecords.length,total:normalized.images.length});
  }
  if (!normalized.hasScreenData) {
    const current = await loadState();
    const records = await transact('images', 'readonly', store => store.getAll());
    const preserved = preserveScreenOnLegacyRestore(normalized.state, current, imageRecords, records);
    normalized.state = preserved.state;
    imageRecords = preserved.images;
  }
  if (!normalized.hasSessionData) normalized.state.sessions = structuredClone((await loadState()).sessions);
  const db = await openDb();
  try { await new Promise((resolve, reject) => {
    const transaction = db.transaction(["state", "images", "drafts"], "readwrite");
    const stateStore = transaction.objectStore("state");
    const imageStore = transaction.objectStore("images");
    transaction.objectStore("drafts").clear();
    imageStore.clear();
    stateStore.put(normalized.state, "app");
    touchLocalRevision(stateStore);
    imageRecords.forEach((image) => imageStore.put(image));
    transaction.oncomplete = resolve;
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('恢复未完成，原收藏保持不变'));
  }); } finally { db.close(); }
  collectionChanged();
  return rememberPlays(normalized.state);
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

// Read, check revision, and mutate the latest app in ONE transaction. An old
// browser tab cannot silently overwrite a saved session or double-count plays.
async function mutateApp(change) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'), store=tx.objectStore('state');
    let result, failure;
    const read=store.get('app');
    read.onsuccess=()=>{
      try {
        const state=read.result || createDefaultState(); state.sessions ||= [];
        result=change(state);state.meta={...state.meta,updatedAt:new Date().toISOString()};store.put(state,'app');touchLocalRevision(store);
      } catch(error) { failure=error;tx.abort(); }
    };
    tx.oncomplete=()=>{db.close();collectionChanged();resolve(result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(failure || tx.error || Error('保存失败'));};
  });
}
export function saveSession(session, expectedRevision=session.revision) {
  const errors=validateSession(session);if(errors.length) return Promise.reject(Error(errors.join('；')));
  return mutateApp(state=>{
    const index=state.sessions.findIndex(s=>s.id===session.id), old=state.sessions[index];
    if ((old?.revision||0)!==expectedRevision || (!old && expectedRevision>0)) throw Error('这条桌游局已在其他窗口修改或删除。请保留草稿并重新打开记录。');
    // Synced entries must retain their receipts even when reordered or edited.
    for(const item of old ? sessionItems(old) : []) if(item.synced>0) {
      const next=sessionItems(session).find(i=>i.id===item.id && i.gameId===item.gameId);
      if(!next || next.synced!==item.synced || next.actual<item.synced) throw Error('已同步的桌游不能移除，实玩局数不能少于已同步局数');
    }
    const next={...structuredClone(session),revision:expectedRevision+1,updatedAt:new Date().toISOString()};
    if(index<0)state.sessions.push(next);else state.sessions[index]=next;
    return next;
  });
}
export function deleteSession(id, revision) {
  return mutateApp(state=>{
    const old=state.sessions.find(s=>s.id===id);
    if(!old || old.revision!==revision) throw Error('记录已变化，请重新打开后操作');
    state.sessions=state.sessions.filter(s=>s.id!==id);
  });
}
export function syncSession(id, revision) {
  return mutateApp(state=>{
    const session=state.sessions.find(s=>s.id===id);
    if(!session || session.revision!==revision) throw Error('记录已变化，请重新打开后同步');
    const added=syncSessionPlays(state,id);
    session.revision++;session.updatedAt=new Date().toISOString();
    return {session:structuredClone(session),added};
  });
}
export function setSessionPin(pinHash) {
  return mutateApp(state=>{
    if(state.security.pinHash && state.security.pinHash!==pinHash) throw Error('密码已在其他页面设置，请输入现有密码');
    state.security.pinHash=pinHash;
  });
}
export async function snapshotCover(id) {
  const blob=await getImage(id);return blob ? blobToDataUrl(blob) : '';
}

export const loadCloudMeta = () => transact('state','readonly',store=>store.get('cloud-sync'));
export const saveCloudMeta = meta => transact('state','readwrite',store=>store.put(meta,'cloud-sync'));
export const loadCloudCheckpoint = () => transact('state','readonly',store=>store.get('cloud-checkpoint'));
export const listImageRecords = () => transact('images','readonly',store=>store.getAll());
export const loadLocalRevision = async () => (await transact('state','readonly',store=>store.get('local-revision'))) || 0;

// Downloads finish before this transaction. Never clear images or unsaved drafts.
// Refuse to apply if a local save raced with the network operation.
export async function applyCloudState(expected, incoming, images, meta, expectedRevision) {
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['state','images'],'readwrite'), store=tx.objectStore('state');
    let failure;
    const revision=store.get('local-revision');
    const read=store.get('app');
    read.onsuccess=()=>{
      try {
        const current=read.result || createDefaultState();
        if(expectedRevision!==undefined && (revision.result || 0)!==expectedRevision)throw Error('LOCAL_CHANGED');
        if (!same(cloudState(current),expected)) throw Error('LOCAL_CHANGED');
        const oldImages=tx.objectStore('images').getAll();
        oldImages.onsuccess=()=>store.put({state:structuredClone(current),images:oldImages.result,
          savedAt:new Date().toISOString()},'cloud-checkpoint');
        const next={...current,...structuredClone(incoming),
          view:current.view, meta:{...current.meta,updatedAt:new Date().toISOString()},
          screen:{...current.screen,...structuredClone(incoming.screen),view:current.screen.view}};
        const checked=normalizeBackup({format:'tabletop-and-screen',version:1,state:next,images:[]}).state;
        store.put(checked,'app');store.put(meta,'cloud-sync');
        touchLocalRevision(store);
        for(const image of images)tx.objectStore('images').put(image);
      } catch(error) {failure=error;tx.abort();}
    };
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onabort=tx.onerror=()=>{db.close();reject(failure || tx.error || Error('云端收藏未应用，本地数据保持不变'));};
  });
}
