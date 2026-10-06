import {cloudState, counts} from './cloud-domain.js';
import {loadState, createBackupPayload, downloadBackup, loadCloudCheckpoint, makeBackupPayload} from './storage.js';
import {startCloudSync, cloudStatus, isConnected, inspectCloud, connectCloud, syncCloud, disconnectCloud} from './cloud-sync.js';
import {showDialogWithoutScroll} from './dialog-position.js';

const drawer=document.querySelector('#backupDrawer');
if(drawer) {
  const panel=document.createElement('section');panel.className='cloud-panel';
  panel.innerHTML=`<h3>私人云同步</h3><p id="cloudStatus" role="status" aria-live="polite">尚未连接云端</p>
    <form id="cloudConnectForm"><label for="cloudKey">设备连接码</label>
      <input id="cloudKey" type="password" autocomplete="off" spellcheck="false" placeholder="输入电脑与手机共用的连接码" minlength="43" maxlength="43" required>
      <button class="secondary-button" type="submit">连接云端</button></form>
    <div class="cloud-actions" id="cloudConnected" hidden><button type="button" class="secondary-button" id="cloudNow">立即同步</button>
      <button type="button" class="ghost-button" id="cloudReconnect">重新选择来源</button>
      <button type="button" class="ghost-button" id="cloudDisconnect">断开连接</button></div>
    <button type="button" class="ghost-button" id="cloudCheckpoint">导出同步前快照</button>
    <p class="drawer-note">连接后自动同步已保存的收藏与封面。编辑草稿、筛选和卡片大小留在当前设备；离线修改保留，联网补传。图片预算100 MB，单张上限8 MB。连接码可访问私人收藏，请勿分享。</p>`;
  drawer.append(panel);
  const css=document.createElement('link');css.rel='stylesheet';css.href='css/cloud.css';document.head.append(css);
  const $=selector=>panel.querySelector(selector);
  function renderStatus() {
    const state=cloudStatus();$('#cloudStatus').textContent=state.message;
    $('#cloudConnected').hidden=!isConnected();$('#cloudConnectForm').hidden=isConnected();
    $('#cloudReconnect').hidden=!['conflict','initial','error'].includes(state.kind);
    const busy=state.kind==='syncing';panel.querySelectorAll('button,input').forEach(el=>el.disabled=busy);
  }
  const dialog=document.createElement('dialog');dialog.className='app-dialog liquid-strong cloud-dialog';
  dialog.innerHTML=`<form method="dialog"><h2>选择同步来源</h2><p id="cloudCompare"></p>
    <p>选择一端作为完整来源。覆盖前自动导出本地备份，云端保留最近修订。首次请在电脑选择「使用本地」，手机选择「使用云端」。</p>
    <div class="cloud-actions"><button class="secondary-button" value="local">使用本地</button>
      <button class="secondary-button" value="remote">使用云端</button><button class="ghost-button" value="cancel">取消</button></div></form>`;
  document.body.append(dialog);
  let choosing=false;
  async function choose(key) {
    if(choosing)return;choosing=true;
    try {
      const remote=await inspectCloud(key), local=cloudState(await loadState());
      dialog.querySelector('#cloudCompare').textContent=`本地：${counts(local)}。云端：${remote.document?counts(remote.document.state):'尚无收藏'}。`;
      dialog.querySelector('[value="remote"]').disabled=!remote.document;
      dialog.returnValue='';showDialogWithoutScroll(dialog,dialog.querySelector('[value="cancel"]'));
      const source=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
      if(!['local','remote'].includes(source))return;
      // This contains the original images too, including ID collisions from restored backups.
      downloadBackup(await createBackupPayload(),'一桌一屏-连接云端前备份');
      await connectCloud(key,source,{revision:remote.revision,local});$('#cloudKey').value='';
    } catch(error) {$('#cloudStatus').textContent=error.message;}
    finally {choosing=false;}
  }
  $('#cloudConnectForm').addEventListener('submit',event=>{event.preventDefault();choose($('#cloudKey').value.trim());});
  $('#cloudNow').onclick=syncCloud;
  $('#cloudReconnect').onclick=()=>choose(localStorage.getItem('tts-cloud-key'));
  $('#cloudDisconnect').onclick=()=>{if(confirm('断开本设备的云同步？本地收藏保留。'))disconnectCloud();};
  $('#cloudCheckpoint').onclick=async()=>{
    try {
      const snapshot=await loadCloudCheckpoint();
      if(!snapshot)throw Error('尚无同步前快照');
      // Stored originals make the snapshot independent of the current image cache.
      const images=[];
      for(const image of snapshot.images || []) {
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(image.original);});
        images.push({id:image.id,name:image.name,type:image.type,data});
      }
      downloadBackup(makeBackupPayload(snapshot.state,images,snapshot.savedAt),'一桌一屏-同步前快照');
    } catch(error) {$('#cloudStatus').textContent=error.message;}
  };
  window.addEventListener('tts-sync-status',renderStatus);renderStatus();
}
startCloudSync();
