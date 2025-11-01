// font-boot.js
import { setFontScale } from '.common.js';

const KEY = 'ui.fontScale';
const MIN = 0.8, MAX = 1.6, STEP = 0.05;

function load() {
  const s = parseFloat(localStorage.getItem(KEY));
  return Number.isFinite(s) ? s : 1;
}
function reflect(v){
  const $val = document.getElementById('fontVal');
  const $help = document.getElementById('fontHelp');
  document.getElementById('fontRange').setAttribute('aria-valuenow', String(v));
  if ($val)  $val.textContent  = `${v.toFixed(2)}×`;
  if ($help) $help.textContent = `본문 1rem = ${(16*v).toFixed(0)}px`;
}

document.addEventListener('DOMContentLoaded', () => {
  const $range = document.getElementById('fontRange');
  if (!$range) return;

  // 범위 세팅
  $range.min = String(MIN);
  $range.max = String(MAX);
  $range.step = String(STEP);

  // 초기값
  const cur = load();
  $range.value = String(cur);
  reflect(cur);

  // 미리보기
  $range.addEventListener('input', (e) => {
    const v = Math.min(MAX, Math.max(MIN, parseFloat(e.target.value)));
    setFontScale(v);
    reflect(v);
  });

  // 저장
  document.getElementById('fontSave')?.addEventListener('click', () => {
    const v = parseFloat($range.value);
    localStorage.setItem(KEY, String(v)); // setFontScale가 이미 적용 중
    reflect(v);
  });

  // 기본값
  document.getElementById('fontReset')?.addEventListener('click', () => {
    const v = 1;
    $range.value = String(v);
    setFontScale(v);
    localStorage.setItem(KEY, String(v));
    reflect(v);
  });
});
