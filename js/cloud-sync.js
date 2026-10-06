import {cloudState, coverIds, same, mergeCloud, mergeImages} from './cloud-domain.js';
import {loadState, listImageRecords, loadCloudMeta, applyCloudState, loadLocalRevision} from './storage.js';
import {digest, validKey, validateDocument} from './cloud-protocol.js';

const ENDPOINT='https://tabletop-screen-sync.pages.dev/api/sync';
const CREDENTIAL='tts-cloud-key';
let running=false, timer, status={kind:'disconnected',message:'尚未连接云端'}, paused=false;
let blocked=()=>false;
const channel=typeof BroadcastChannel==='function' ? new BroadcastChannel('tts-cloud-events') : null;
if(channel)channel.onmessage=()=>{if(!blocked())window.dispatchEvent(new Event('tts-cloud-applied'));};
export function setCloudGuard(guard) {blocked=guard;}
export function cloudStatus() {return status;}
function report(kind,message,extra={}) {
  status={kind,message,...extra};window.dispatchEvent(new CustomEvent('tts-sync-status',{detail:status}));
}
export function isConnected() {return validKey(localStorage.getItem(CREDENTIAL));}
export function disconnectCloud() {
  localStorage.removeItem(CREDENTIAL);paused=false;report('disconnected','已断开云端，本地收藏保留');
}
async function request(key,query='',options={}) {
  let response;
  const stage=query ? (options.method==='PUT'?'上传封面':'下载封面') : options.method==='PUT'?'保存云端记录':'连接云端';
  try {
    // The server already sends Cache-Control: no-store. A client cache override
    // can add Cache-Control/Pragma headers and fail Safari's CORS preflight.
    response=await fetch(ENDPOINT+query,{...options,
      headers:{...options.headers,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(60000)});
  } catch(error) {
    throw Error(`${stage}失败：${error.name==='TimeoutError'?'请求超时':'网络请求未完成（Load failed）'}。本地收藏已保留。`);
  }
  if (response.status===409) throw Error('REMOTE_CHANGED');
  if (!response.ok) {
    const data=await response.json().catch(()=>({}));
    throw Error(({UNAUTHORIZED:'连接码无效或已更换',IMAGE_BUDGET_EXCEEDED:'云端图片达到100 MB预算，本地修改已保留',
      IMAGE_SIZE_LIMIT:'单张图片超过8 MB，本地修改已保留',REQUEST_TOO_LARGE:'收藏数据超过云端单次容量限制'})[data.error] || '云端暂不可用，本地收藏保持不变');
  }
  return response;
}
export async function inspectCloud(key) {
  if(!validKey(key))throw Error('连接码应为43位字母、数字、横线或下划线');
  const remote=await (await request(key)).json();
  if (!Number.isSafeInteger(remote.revision) || remote.revision<0 || (remote.document && !validateDocument(remote.document)))throw Error('云端数据格式无效');
  return remote;
}
async function localImages(state) {
  const records=await listImageRecords(), byId=new Map(records.map(i=>[i.id,i])), manifest=[];
  for(const id of coverIds(state)) {
    const record=byId.get(id);
    if(!record)throw Error('本地封面缺失，请恢复完整备份后再同步');
    manifest.push({id,hash:await digest(await record.original.arrayBuffer()),
      bytes:record.original.size,mime:record.original.type || record.type});
  }
  return {byId,manifest};
}
async function downloadImage(key,item,index,total) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const blob=await (await request(key,`?image=${item.hash}`)).blob();
      if(blob.size!==item.bytes || await digest(await blob.arrayBuffer())!==item.hash)
        throw Error('IMAGE_INCOMPLETE');
      return new Blob([blob],{type:item.mime});
    } catch(error) {
      // Downloads are immutable and safe to retry. Do not retry authentication errors.
      if(error.message.includes('连接码无效'))throw error;
      if(attempt===2)throw Error(`下载第 ${index} / ${total} 张封面失败：${error.message==='IMAGE_INCOMPLETE'?'文件不完整':error.message}。可重新连接重试，原收藏未替换。`);
      report('syncing',`第 ${index} / ${total} 张封面下载中断，重试 ${attempt+1} / 2`);
      await new Promise(resolve=>setTimeout(resolve,800*(attempt+1)));
    }
  }
}
async function prepared(state,selectedImages,localImages,remote,key) {
  const {byId,manifest}=localImages;
  const localHashes=new Map(manifest.map(i=>[i.id,i.hash]));
  const available=new Map(selectedImages.map(i=>[i.id,i]));
  const complete=new Set((remote.document?.images || []).map(i=>i.hash));
  const images=[], downloaded=[];
  const ids=coverIds(state);
  for(let n=0;n<ids.length;n++) {
    const id=ids[n], local=byId.get(id), known=available.get(id);
    report('syncing',`正在同步封面 ${n+1} / ${ids.length}`);
    if (local && known && localHashes.get(id)===known.hash) {
      const item=known;
      if (!complete.has(item.hash)) {
        await request(key,`?image=${item.hash}`,{method:'PUT',headers:{'x-image-type':item.mime},body:local.original});
        complete.add(item.hash);
      }
      images.push(item);
    } else if (known) {
      const original=await downloadImage(key,known,n+1,ids.length);
      downloaded.push({id,name:'cover',type:known.mime,original,thumbnail:original});
      images.push(known);
    } else throw Error('封面文件缺失，本地收藏保持不变');
  }
  return {document:{state,images},downloaded};
}
async function exchange(key,source=null,choice=null) {
  const identity=await digest(new TextEncoder().encode(key));
  const localRevision=await loadLocalRevision();
  const local=cloudState(await loadState());
  const meta=await loadCloudMeta(), remote=await inspectCloud(key);
  if(choice && (choice.revision!==remote.revision || !same(choice.local,local)))throw Error('确认期间收藏发生变化，请重新选择来源');
  if (!source && meta?.identity!==identity) {
    paused=true;report('initial','请先选择本地或云端收藏作为连接来源');return;
  }
  const files=await localImages(local);
  let next, selectedImages;
  if (source==='local') {next=local;selectedImages=files.manifest;}
  else if(source==='remote') {
    if(!remote.document)throw Error('云端尚无收藏，请先从电脑上传');
    next=remote.document.state;selectedImages=remote.document.images;
  } else {
    if(!meta?.document || !remote.document) {paused=true;report('initial','需要重新确认同步来源');return;}
    const merged=mergeCloud(meta.document.state,local,remote.document.state);
    const imageMerge=mergeImages(meta.document.images,files.manifest,remote.document.images);
    if (merged.conflicts.length || imageMerge.conflicts.length) {
      paused=true;report('conflict','两端修改冲突，已保留两份收藏',{
        conflicts:[...merged.conflicts,...imageMerge.conflicts],local,remote:remote.document.state});return;
    }
    next=merged.state;selectedImages=imageMerge.images;
    if(same(local,remote.document.state) && same(files.manifest,remote.document.images) && remote.revision===meta.revision) {
      if(await loadLocalRevision()!==localRevision)throw Error('LOCAL_CHANGED');
      report('synced','已同步', {imageBytes:remote.imageBytes,imageBudget:remote.imageBudget});return;
    }
  }
  const {document,downloaded}=await prepared(next,selectedImages,files,remote,key);
  // Check both the local state and the user's connection before publishing changes.
  if(blocked() || await loadLocalRevision()!==localRevision || !same(cloudState(await loadState()),local))throw Error('LOCAL_CHANGED');
  if(!source && localStorage.getItem(CREDENTIAL)!==key)throw Error('连接已更换，操作取消');
  let revision=remote.revision;
  if(!same(document,remote.document)) {
    const saved=await (await request(key,'',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({expected:remote.revision,document})})).json();
    revision=saved.revision;
  }
  if(blocked())throw Error('LOCAL_CHANGED');
  await applyCloudState(local,next,downloaded,{identity,revision,document},localRevision);
  window.dispatchEvent(new Event('tts-cloud-applied'));
  channel?.postMessage('applied');
  report('synced','已同步', {imageBytes:remote.imageBytes,imageBudget:remote.imageBudget});
}
export async function connectCloud(key,source,choice=null) {
  if(running || blocked())throw Error('请先保存或取消当前编辑，再连接云端');
  if(!validKey(key) || !['local','remote'].includes(source))throw Error('连接信息无效');
  running=true;
  try {
    report('syncing','正在连接云端');await exchange(key,source,choice);
    localStorage.setItem(CREDENTIAL,key);paused=false;report('synced','已同步');
  } catch(error) {report('error',error.message);throw error;} finally {running=false;}
}
export async function syncCloud() {
  if(running || paused || !isConnected() || document.hidden)return;
  if(blocked()) {report('waiting','编辑完成后自动同步');return;}
  if(!navigator.onLine) {report('offline','离线可编辑，联网后自动同步');return;}
  running=true;
  try {report('syncing','正在检查云端');await exchange(localStorage.getItem(CREDENTIAL));}
  catch(error) {
    if(['REMOTE_CHANGED','LOCAL_CHANGED'].includes(error.message)) {
      report('waiting','保存期间有新修改，正在重新检查');schedule();
    } else report('error',error.message);
  } finally {running=false;}
}
function schedule() {clearTimeout(timer);timer=setTimeout(syncCloud,1200);}
export function startCloudSync() {
  window.addEventListener('tts-local-save',schedule);
  window.addEventListener('online',schedule);
  window.addEventListener('focus',schedule);
  window.addEventListener('storage',event=>{if(event.key===CREDENTIAL){paused=false;schedule();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  setInterval(()=>{if(!document.hidden)syncCloud();},60000);
  if(isConnected())schedule();
}
