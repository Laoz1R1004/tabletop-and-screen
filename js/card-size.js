const control = document.querySelector('#cardSizeSelect');
const scales = {small: 0.8, medium: 1, large: 1.2};
const key = `tabletop-screen:card-size:${document.body.classList.contains('screen-collection-page') ? 'screen' : 'tabletop'}`;

function applySize(value) {
  const size = Object.hasOwn(scales, value) ? value : 'medium';
  control.value = size;
  document.querySelector('#collection').style.setProperty('--card-scale', scales[size]);
}

let saved;
try { saved = localStorage.getItem(key); } catch { /* Sizing still works when storage is blocked. */ }
applySize(saved);
control.addEventListener('change', () => {
  applySize(control.value);
  try { localStorage.setItem(key, control.value); } catch { /* Keep the choice for this visit. */ }
});
