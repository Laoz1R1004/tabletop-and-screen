const installButton = document.createElement('button');
installButton.type = 'button';
installButton.className = 'icon-text-button';
installButton.hidden = true;
installButton.title = '安装一桌·一屏到电脑';
installButton.setAttribute('aria-label', installButton.title);
installButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 16v4h14v-4"/></svg><span>安装应用</span>';
(document.querySelector('.nav-actions') || document.querySelector('.home-brand')).append(installButton);

let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  await prompt.prompt();
  await prompt.userChoice;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    console.warn('离线支持暂不可用，联网访问不受影响。', error);
  });
}
