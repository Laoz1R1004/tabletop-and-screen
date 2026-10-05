// Hide the initial paint until the site's brand face is ready, without moving layout.
document.documentElement.classList.add('brand-font-loading');
document.addEventListener('DOMContentLoaded', async () => {
  try { await document.fonts.load('16px ZhuoYi', '一桌一屏'); }
  catch (error) { console.warn('品牌字体加载失败，使用系统字体。', error); }
  finally { document.documentElement.classList.remove('brand-font-loading'); }
}, {once:true});
