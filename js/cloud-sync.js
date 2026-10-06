import {cloudState, coverIds, same, mergeCloud, mergeImages} from './cloud-domain.js';
import {loadState, listImageRecords, loadCloudMeta, applyCloudState, loadLocalRevision} from './storage.js';
import {digest, validKey, validateDocument} from './cloud-protocol.js';

const ENDPOINT='https://fjygcqmvcouvlbmblakk.supabase.co/functions/v1/dynamic-processor';
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
  const response=await fetch(ENDPOINT+query,{...options,cache:'no-store',
    headers:{...options.headers,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(60000)});
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
      const blob=await (await request(key,`?image=${known.hash}`)).blob();
      if(blob.size!==known.bytes || await digest(await blob.arrayBuffer())!==known.hash)throw Error('云端封面不完整，本地收藏保持不变');
      const original=new Blob([blob],{type:known.mime});
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
