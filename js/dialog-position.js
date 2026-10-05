export function showDialogWithoutScroll(dialog, input) {
  const x = scrollX, y = scrollY;
  dialog.showModal();
  input?.focus({preventScroll:true});
  scrollTo({left:x, top:y, behavior:'instant'});
  dialog.addEventListener('close', () => {
    requestAnimationFrame(() => scrollTo({left:x, top:y, behavior:'instant'}));
  }, {once:true});
}
