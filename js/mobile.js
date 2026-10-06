// Responsive presentation only. Collection storage and desktop behavior are unchanged.
const mobile = matchMedia('(max-width:1023px)');
const collection = document.querySelector('#collection');
const sizes = {small:.8, medium:1, large:1.2};
function fitCards() {
  if (!mobile.matches || !collection) return;
  const selected = document.querySelector('#cardSizeSelect')?.value || 'medium';
  collection.style.setProperty('--mobile-card-scale',Math.min(sizes[selected] || 1,collection.clientWidth / 320));
}
if (collection) {
  new ResizeObserver(fitCards).observe(collection);
  document.querySelector('#cardSizeSelect')?.addEventListener('change',fitCards);
}
let directory;
function adaptDirectory() {
  const nav=document.querySelector('#chapterNav');
  if (!nav) return;
  if (mobile.matches && !directory) {
    directory=document.createElement('details');directory.className='mobile-theater-directory';
    directory.innerHTML='<summary>章节目录 · 点击展开</summary>';
    nav.before(directory);directory.append(nav);
  } else if (!mobile.matches && directory) {
    directory.before(nav);directory.remove();directory=null;
  }
}
function showLesson() {
  if (!mobile.matches) return;
  if (directory) directory.open=false;
  requestAnimationFrame(()=>document.querySelector('#lesson:not([hidden]), #detailPanel:not([hidden])')?.scrollIntoView({block:'start',behavior:'instant'}));
}
document.querySelector('#chapterNav')?.addEventListener('click',e=>{if(e.target.closest('button'))showLesson();});
for (const id of ['next','previous','returnLesson']) document.getElementById(id)?.addEventListener('click',showLesson);
mobile.addEventListener('change',()=>{adaptDirectory();fitCards();});
adaptDirectory();fitCards();
for (const [id,label] of [['backupButton','备份与恢复'],['categoryButton','分类管理']]) {
  const button=document.getElementById(id);if(button){button.setAttribute('aria-label',label);button.title=label;}
}

// Safari does not fire beforeinstallprompt; expose the native Add to Home Screen path.
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (ios && mobile.matches && !standalone) {
  const install=document.querySelector('[data-mobile-install]');
  if (install) {
    install.hidden=false;install.title='添加一桌·一屏到主屏幕';install.setAttribute('aria-label',install.title);
    install.addEventListener('click',()=>{
      let dialog=document.getElementById('mobileInstallHelp');
      if (!dialog) {
        dialog=document.createElement('dialog');dialog.id='mobileInstallHelp';dialog.className='app-dialog liquid-strong mobile-install-help';
        dialog.innerHTML='<form method="dialog"><div class="dialog-head"><h2>添加到主屏幕</h2><button class="square-button" value="close" aria-label="关闭">×</button></div><p>在 Safari 中打开一桌·一屏，点击浏览器的「分享」，选择「添加到主屏幕」，再点击「添加」。</p><p>之后即可从主屏幕图标打开。如果新打开的应用中收藏为空，可通过「备份与恢复」导入电脑导出的备份。</p><button class="primary-button" value="close">知道了</button></form>';
        document.body.append(dialog);
      }
      dialog.showModal();
    });
  }
}
