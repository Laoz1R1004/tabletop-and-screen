import {startCloudSync,cloudStatus,loginCloud,isConnected} from './cloud-sync.js';

// Authentication is separate from backups. No connection codes or source selection.
const css=document.createElement('link');css.rel='stylesheet';css.href='css/cloud.css';document.head.append(css);
const gate=document.createElement('section');gate.className='collection-login';gate.hidden=true;
gate.innerHTML=`<form class="liquid-strong" aria-label="打开收藏"><h1>一桌·一屏</h1>
  <p>输入现有六位密码，打开你的收藏。</p>
  <label for="collectionPin">收藏密码</label><input id="collectionPin" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{6}" minlength="6" maxlength="6" required>
  <button class="primary-button" type="submit">打开收藏</button>
  <p class="collection-login-error" role="status"></p><small>此设备会记住登录，下次直接进入。</small></form>`;
document.body.append(gate);
const notice=document.createElement('p');notice.className='collection-status';notice.setAttribute('role','status');notice.hidden=true;document.body.append(notice);
let submitting=false;
let loaded=false;
function render() {
  const state=cloudStatus();
  if(state.kind==='synced')loaded=true;
  gate.hidden=state.kind!=='login' && (loaded || !['loading','syncing','error'].includes(state.kind));
  const needsPassword=state.kind==='login';
  gate.querySelector('label').hidden=!needsPassword;
  gate.querySelector('input').hidden=!needsPassword;
  gate.querySelector('button').hidden=!needsPassword;
  gate.querySelector('small').hidden=!needsPassword;
  gate.querySelector('form > p').textContent=needsPassword?'输入现有六位密码，打开你的收藏。':'正在打开你的收藏…';
  document.querySelector('main')?.toggleAttribute('inert',!gate.hidden);
  if(!gate.hidden && !submitting)gate.querySelector('.collection-login-error').textContent=state.message;
  const status=document.querySelector('#backupStatus');
  if(status && ['error','offline'].includes(state.kind))status.textContent=state.message;
  notice.hidden=!loaded || !['error','offline','waiting'].includes(state.kind);
  notice.textContent=state.message;
}
gate.querySelector('form').onsubmit=async event=>{
  event.preventDefault();if(submitting)return;submitting=true;
  const button=gate.querySelector('button');button.disabled=true;
  try {await loginCloud(gate.querySelector('input').value);gate.querySelector('input').value='';render();}
  catch(error){gate.querySelector('.collection-login-error').textContent=error.message;}
  finally {submitting=false;button.disabled=false;}
};
window.addEventListener('tts-sync-status',render);
if(!isConnected())gate.hidden=false;
startCloudSync();render();
